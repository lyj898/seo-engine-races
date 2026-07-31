#!/usr/bin/env node
/**
 * refresh-entities.js
 *
 * Re-verifies existing entities under /data/entities against a source URL
 * already recorded on that entity (entity.source_mix), updating core_facts
 * only where the fresh source explicitly contradicts the current value.
 * Does not invent or add new entities -- that's discover-entities.js.
 *
 * Status changes are deliberately conservative -- this script can FLAG an
 * entity for human review, but it never promotes anything to "active".
 * Those remain human decisions (site.config.json's enabledFeatures.reviewQueue
 * exists for exactly this). The one exception is lapsing: an entity whose
 * core_facts.date has already passed is auto-archived below, before any
 * fetch/Claude call -- a race that already happened isn't an editorial
 * judgment call the way "source says cancelled" is, so it doesn't need a
 * human in the loop, and skipping the fetch/Claude step for it also saves
 * an API call on every entity that's aged out.
 *
 * Legal/safety reminders (do not remove):
 *   - Respects robots.txt and sourceConfig.requestDelayMs for every fetch.
 *   - Never persists raw scraped HTML anywhere in /data.
 *   - If a fact can no longer be verified (source unreachable), this lowers
 *     reliability_score and flags for review rather than silently keeping
 *     stale data as if it were still fresh.
 */
import fs from 'node:fs';

import siteConfig from '../src/lib/config.js';
import { getEntitySchema, getCoreFactsSchema } from '../src/lib/schema/index.js';
import { loadEntities, stripMeta } from '../src/lib/data.js';

import { fetchText, htmlToText, truncateForPrompt } from './lib/http.js';
import { isAllowed } from './lib/robots.js';
import { throttle } from './lib/rate-limit.js';
import { callClaudeForJson } from './lib/anthropic-client.js';
import { buildRefreshPrompt } from './lib/prompts.js';
import { describeSchemaShape } from './lib/schema-describe.js';

const today = () => new Date().toISOString().slice(0, 10);
const SOURCE_TYPE_PRIORITY = ['official', 'registration_platform', 'aggregator', 'review', 'social', 'other'];

function pickSourceToCheck(sourceMix) {
  if (!sourceMix || sourceMix.length === 0) return undefined;
  const sorted = [...sourceMix].sort(
    (a, b) => SOURCE_TYPE_PRIORITY.indexOf(a.type) - SOURCE_TYPE_PRIORITY.indexOf(b.type)
  );
  return sorted[0];
}

async function run() {
  const { verticalKey, sourceConfig } = siteConfig;
  const userAgent = sourceConfig?.userAgent ?? `programmatic-seo-engine/1.0 (+https://${siteConfig.siteDomain})`;
  const delayMs = sourceConfig?.requestDelayMs ?? 2000;

  const coreFactsSchema = getCoreFactsSchema(verticalKey);
  const entitySchema = getEntitySchema(verticalKey);
  const coreFactsDescription = describeSchemaShape(coreFactsSchema);

  const rawEntities = loadEntities();
  const targets = rawEntities.filter((e) => ['active', 'needs_review'].includes(stripMeta(e).status));

  const stats = { checked: 0, lapsed: 0, noSource: 0, fetchFailed: 0, unchanged: 0, changed: 0, flagged: 0, invalidSkipped: 0 };
  const todayStr = today();

  for (const raw of targets) {
    const entity = stripMeta(raw);
    stats.checked++;

    // Lapsed check first, before any fetch/Claude call: a race whose date
    // has already passed is done, full stop -- no source can "un-happen"
    // it, so there's nothing to verify. Dates are ISO "YYYY-MM-DD", so a
    // plain string comparison is correct here.
    if (entity.core_facts?.date && entity.core_facts.date < todayStr) {
      const updated = { ...entity, status: 'archived', last_updated: todayStr };
      const wrote = writeIfValid(raw.__file, updated, entitySchema);
      if (wrote) stats.lapsed++;
      else stats.invalidSkipped++;
      continue;
    }

    const source = pickSourceToCheck(entity.source_mix);
    if (!source) {
      console.log(`[refresh-entities] ${entity.slug}: no source_mix entries to refresh from -- skipping.`);
      stats.noSource++;
      continue;
    }

    let allowed;
    try {
      allowed = await isAllowed(source.url, userAgent);
    } catch (err) {
      console.warn(`[refresh-entities] ${entity.slug}: robots.txt check failed, skipping for safety: ${err.message}`);
      continue;
    }
    if (!allowed) {
      console.log(`[refresh-entities] ${entity.slug}: source disallows ${userAgent} via robots.txt -- skipping.`);
      continue;
    }

    await throttle(new URL(source.url).hostname, delayMs);

    let html;
    try {
      html = await fetchText(source.url, { userAgent });
    } catch (err) {
      // Source is unreachable -- don't silently keep presenting stale data
      // as verified. Lower reliability_score and flag for human review.
      console.warn(`[refresh-entities] ${entity.slug}: fetch failed for ${source.url}: ${err.message} -- flagging for review.`);
      const updated = {
        ...entity,
        reliability_score: Math.max(0, entity.reliability_score - 15),
        status: entity.status === 'active' ? 'needs_review' : entity.status,
        last_updated: today(),
      };
      writeIfValid(raw.__file, updated, entitySchema);
      stats.fetchFailed++;
      continue;
    }

    const sourceText = truncateForPrompt(htmlToText(html));
    const { system, prompt } = buildRefreshPrompt({
      siteConfig,
      entity,
      coreFactsDescription,
      sourceUrl: source.url,
      sourceText,
    });

    let result;
    try {
      result = await callClaudeForJson({ system, prompt, maxTokens: 1500 });
    } catch (err) {
      console.warn(`[refresh-entities] ${entity.slug}: Claude call failed: ${err.message} -- leaving unchanged.`);
      continue;
    }

    const changedFields = result && typeof result === 'object' && result.changed_fields && typeof result.changed_fields === 'object'
      ? result.changed_fields
      : {};
    const hasChanges = Object.keys(changedFields).length > 0;

    let mergedCoreFacts = entity.core_facts;
    if (hasChanges) {
      const candidateCoreFacts = { ...entity.core_facts, ...changedFields };
      const coreFactsResult = coreFactsSchema.safeParse(candidateCoreFacts);
      if (!coreFactsResult.success) {
        console.warn(
          `[refresh-entities] ${entity.slug}: proposed core_facts change failed validation, ignoring changed_fields: ${coreFactsResult.error.issues
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; ')}`
        );
      } else {
        mergedCoreFacts = coreFactsResult.data;
      }
    }
    const factsActuallyChanged = JSON.stringify(mergedCoreFacts) !== JSON.stringify(entity.core_facts);

    // Conservative status logic: this script can only flag for review, never
    // auto-promote to active and never auto-archive.
    let newStatus = entity.status;
    if (result?.status_recommendation === 'archived' && entity.status !== 'archived') {
      newStatus = 'needs_review';
    } else if (factsActuallyChanged && entity.status === 'active') {
      newStatus = 'needs_review';
    }

    let reliabilityDelta = 0;
    if (result?.confidence === 'high' && newStatus === entity.status && !factsActuallyChanged) reliabilityDelta = 3;
    else if (result?.confidence === 'low') reliabilityDelta = -5;

    const updatedSourceMix = entity.source_mix.map((s) => (s.url === source.url ? { ...s, last_checked: today() } : s));

    const updated = {
      ...entity,
      core_facts: mergedCoreFacts,
      reliability_score: Math.min(100, Math.max(0, entity.reliability_score + reliabilityDelta)),
      source_mix: updatedSourceMix,
      status: newStatus,
      last_updated: today(),
    };

    const wrote = writeIfValid(raw.__file, updated, entitySchema);
    if (!wrote) {
      stats.invalidSkipped++;
    } else if (newStatus !== entity.status || (result?.status_recommendation === 'archived' && entity.status !== 'archived')) {
      stats.flagged++;
    } else if (factsActuallyChanged) {
      stats.changed++;
    } else {
      stats.unchanged++;
    }
  }

  console.log(
    `\n[refresh-entities] done. Checked: ${stats.checked}, lapsed (auto-archived): ${stats.lapsed}, ` +
      `no source: ${stats.noSource}, fetch failed: ${stats.fetchFailed}, ` +
      `facts changed: ${stats.changed}, flagged for review: ${stats.flagged}, unchanged (re-verified): ${stats.unchanged}, ` +
      `invalid after merge (skipped write): ${stats.invalidSkipped}.`
  );
}

function writeIfValid(filePath, updatedEntity, entitySchema) {
  const validation = entitySchema.safeParse(updatedEntity);
  if (!validation.success) {
    console.warn(
      `[refresh-entities] ${updatedEntity.slug}: updated entity failed schema validation, NOT writing: ${validation.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`
    );
    return false;
  }
  // filePath is "data/entities/foo.json" (relative, from data.js's __file
  // metadata) -- resolve it the same way data.js does, from repo root.
  fs.writeFileSync(new URL(`../${filePath}`, import.meta.url), JSON.stringify(validation.data, null, 2) + '\n');
  return true;
}

run().catch((err) => {
  console.error('[refresh-entities] fatal error:', err);
  process.exit(1);
});
