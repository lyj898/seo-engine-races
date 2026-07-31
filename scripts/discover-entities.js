#!/usr/bin/env node
/**
 * discover-entities.js
 *
 * Finds NEW entities for the active vertical (site.config.json.verticalKey)
 * from site.config.json.sourceConfig.trustedAggregators, using Claude to
 * extract structured candidates from each source's page content. Every
 * candidate is validated against the universal + per-vertical schema
 * before anything is written to /data/entities -- invalid or duplicate
 * candidates are skipped and logged, never silently coerced into shape.
 *
 * Vertical-agnostic by construction: category_id/region_id assignment
 * works by asking Claude to match against this vertical's OWN
 * data/categories and data/regions labels (loaded at runtime), never by
 * hardcoded field logic like "map distance_km to a category" -- that kind
 * of vertical-specific mapping would have to live outside this file.
 *
 * New entities are written with status: "draft" and a placeholder
 * ai_summary (see scripts/lib/constants.js) -- discovery's job is finding
 * verifiable structured facts, not writing marketing copy. Run
 * `npm run summaries` afterward to fill in ai_summary/pros/cons/faqs, and a
 * human should promote status: "draft" -> "active" only after review
 * (site.config.json's enabledFeatures.reviewQueue is exactly this gate).
 *
 * Legal/safety reminders (do not remove):
 *   - Respects robots.txt (scripts/lib/robots.js) and
 *     sourceConfig.requestDelayMs (scripts/lib/rate-limit.js) for every
 *     fetch. Respect each source's Terms of Service too -- robots.txt
 *     compliance is necessary but not sufficient.
 *   - Never persists raw scraped HTML anywhere in /data.
 *   - Never invents a fact (enforced via the prompt in scripts/lib/prompts.js
 *     and via schema validation of the response).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import siteConfig from '../src/lib/config.js';
import { getEntitySchema, getCoreFactsSchema } from '../src/lib/schema/index.js';
import { loadEntities, loadCategories, loadRegions, stripMeta } from '../src/lib/data.js';

import { slugify } from './lib/slugify.js';
import { fetchText, htmlToText, truncateForPrompt } from './lib/http.js';
import { isAllowed } from './lib/robots.js';
import { throttle } from './lib/rate-limit.js';
import { callClaudeForJson } from './lib/anthropic-client.js';
import { buildDiscoveryPrompt } from './lib/prompts.js';
import { describeSchemaShape } from './lib/schema-describe.js';
import { PENDING_SUMMARY_MARKER, DRAFT_RELIABILITY_SCORE } from './lib/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENTITIES_DIR = path.resolve(__dirname, '../data/entities');
const today = () => new Date().toISOString().slice(0, 10);

function findByLabel(items, label) {
  if (!label) return undefined;
  const target = label.trim().toLowerCase();
  return items.find((i) => i.label.trim().toLowerCase() === target);
}

async function run() {
  const { verticalKey, entityLabelSingular, sourceConfig } = siteConfig;
  const userAgent = sourceConfig?.userAgent ?? `programmatic-seo-engine/1.0 (+https://${siteConfig.siteDomain})`;
  const delayMs = sourceConfig?.requestDelayMs ?? 2000;
  const aggregators = sourceConfig?.trustedAggregators ?? [];

  if (aggregators.length === 0) {
    console.log('[discover-entities] sourceConfig.trustedAggregators is empty -- nothing to discover from.');
    return;
  }

  const coreFactsSchema = getCoreFactsSchema(verticalKey);
  const entitySchema = getEntitySchema(verticalKey);
  const coreFactsDescription = describeSchemaShape(coreFactsSchema);

  // Rolling window bounds, resolved once per run so every candidate in the
  // run is judged against the same "today".
  const windowMonths = sourceConfig?.discoveryWindowMonths;
  let windowBounds = null;
  if (Number.isFinite(windowMonths) && windowMonths > 0) {
    const from = new Date();
    const to = new Date(from);
    to.setMonth(to.getMonth() + windowMonths);
    windowBounds = { months: windowMonths, from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
    console.log(`[discover-entities] date window: ${windowBounds.from} to ${windowBounds.to} (${windowMonths} months).`);
  }

  const existingEntities = loadEntities().map(stripMeta);
  const existingSlugs = new Set(existingEntities.map((e) => e.slug));
  const categories = loadCategories().map(stripMeta);
  const regions = loadRegions().map(stripMeta);

  const stats = { sourcesChecked: 0, sourcesSkipped: 0, candidatesFound: 0, written: 0, skipped: 0 };
  const skipReasons = [];

  for (const source of aggregators) {
    // An entry may be a bare domain ("example.com") or a full URL pointing
    // at a specific listing page ("https://example.com/calendar/vietnam").
    //
    // Bare domains were the original behaviour and it quietly capped what
    // discovery could ever find: a site's homepage is a marketing page with
    // a handful of featured entries, while the actual calendar -- hundreds
    // of rows, filtered by country -- lives a click away and was never
    // fetched. Allowing a deep link means each entry can point at the page
    // that genuinely lists what we're looking for.
    const sourceUrl = /^https?:\/\//i.test(source) ? source : `https://${source}`;
    const domain = new URL(sourceUrl).hostname;
    stats.sourcesChecked++;

    let allowed;
    try {
      allowed = await isAllowed(sourceUrl, userAgent);
    } catch (err) {
      console.warn(`[discover-entities] robots.txt check failed for ${domain}, skipping this run for safety: ${err.message}`);
      stats.sourcesSkipped++;
      continue;
    }
    if (!allowed) {
      console.log(`[discover-entities] ${domain} disallows ${userAgent} via robots.txt -- skipping.`);
      stats.sourcesSkipped++;
      continue;
    }

    await throttle(new URL(sourceUrl).hostname, delayMs);

    let html;
    try {
      html = await fetchText(sourceUrl, { userAgent });
    } catch (err) {
      console.warn(`[discover-entities] fetch failed for ${domain}: ${err.message}`);
      stats.sourcesSkipped++;
      continue;
    }

    const sourceText = truncateForPrompt(htmlToText(html));
    const { system, prompt } = buildDiscoveryPrompt({
      siteConfig,
      coreFactsDescription,
      availableCategories: categories,
      availableRegions: regions,
      sourceUrl,
      sourceText,
    });

    let candidates;
    try {
      candidates = await callClaudeForJson({ system, prompt, maxTokens: 3000 });
    } catch (err) {
      console.warn(`[discover-entities] Claude call failed for ${domain}: ${err.message}`);
      continue;
    }
    if (!Array.isArray(candidates)) {
      console.warn(`[discover-entities] expected a JSON array from ${domain}, got ${typeof candidates} -- skipping.`);
      continue;
    }

    stats.candidatesFound += candidates.length;

    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== 'object' || typeof candidate.name !== 'string' || !candidate.name.trim()) {
        stats.skipped++;
        skipReasons.push(`${domain}: candidate missing a valid "name" -- skipped`);
        continue;
      }

      const slug = slugify(candidate.name);
      if (!slug || existingSlugs.has(slug)) {
        stats.skipped++;
        skipReasons.push(`${domain}: "${candidate.name}" -> slug "${slug}" already exists or is empty -- skipped (not new)`);
        continue;
      }

      const category = findByLabel(categories, candidate.category_label);
      const region = findByLabel(regions, candidate.region_label);
      if (!category) {
        stats.skipped++;
        skipReasons.push(`${domain}: "${candidate.name}" -- no matching category for label "${candidate.category_label}" (add it to data/categories first)`);
        continue;
      }
      if (!region) {
        stats.skipped++;
        skipReasons.push(`${domain}: "${candidate.name}" -- no matching region for label "${candidate.region_label}" (add it to data/regions first)`);
        continue;
      }

      const coreFactsResult = coreFactsSchema.safeParse(candidate.core_facts ?? {});
      if (!coreFactsResult.success) {
        stats.skipped++;
        skipReasons.push(
          `${domain}: "${candidate.name}" -- core_facts failed validation: ${coreFactsResult.error.issues
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; ')}`
        );
        continue;
      }

      // Enforce the rolling date window in code as well as in the prompt.
      // The prompt states the bounds, but a model asked to extract "every
      // entry on this page" will still hand back last year's edition or one
      // three years out often enough to matter, and a stale entry that
      // slips through here has to be found and archived by hand later.
      // Generic: only applies when the vertical's core_facts actually has a
      // `date`, so a dateless vertical is unaffected.
      const candidateDate = coreFactsResult.data.date;
      if (windowBounds && typeof candidateDate === 'string') {
        if (candidateDate < windowBounds.from || candidateDate > windowBounds.to) {
          stats.skipped++;
          skipReasons.push(
            `${domain}: "${candidate.name}" -- date ${candidateDate} is outside the ${windowBounds.months}-month window (${windowBounds.from} to ${windowBounds.to}) -- skipped`
          );
          continue;
        }
      }

      const entity = {
        entity_id: slug,
        slug,
        name: candidate.name.trim(),
        category_id: category.category_id,
        region_id: region.region_id,
        short_description: (candidate.short_description || `${candidate.name.trim()} -- details pending review.`).slice(0, 220),
        ai_summary: PENDING_SUMMARY_MARKER,
        core_facts: coreFactsResult.data,
        pros: [],
        cons: [],
        excerpt_quotes: [],
        faqs: [],
        reliability_score: DRAFT_RELIABILITY_SCORE,
        tags: Array.isArray(candidate.tags) ? candidate.tags.filter((t) => typeof t === 'string' && t.trim()) : [],
        source_mix: [
          {
            url: typeof candidate.source_url === 'string' && candidate.source_url ? candidate.source_url : sourceUrl,
            label: domain,
            type: 'aggregator',
            last_checked: today(),
          },
        ],
        affiliate_links: [],
        cta_links: [],
        related_entity_ids: [],
        last_updated: today(),
        status: 'draft',
      };

      const validation = entitySchema.safeParse(entity);
      if (!validation.success) {
        stats.skipped++;
        skipReasons.push(
          `${domain}: "${candidate.name}" -- assembled entity failed schema validation: ${validation.error.issues
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; ')}`
        );
        continue;
      }

      fs.mkdirSync(ENTITIES_DIR, { recursive: true });
      fs.writeFileSync(path.join(ENTITIES_DIR, `${slug}.json`), JSON.stringify(validation.data, null, 2) + '\n');
      existingSlugs.add(slug);
      stats.written++;
      console.log(`[discover-entities] wrote new ${entityLabelSingular}: ${slug} (status: draft, needs summary + review)`);
    }
  }

  console.log(
    `\n[discover-entities] done. Sources checked: ${stats.sourcesChecked} (${stats.sourcesSkipped} skipped), ` +
      `candidates found: ${stats.candidatesFound}, written: ${stats.written}, skipped: ${stats.skipped}.`
  );
  if (skipReasons.length > 0) {
    console.log('\nSkip reasons:');
    for (const reason of skipReasons) console.log(`  - ${reason}`);
  }
}

run().catch((err) => {
  console.error('[discover-entities] fatal error:', err);
  process.exit(1);
});
