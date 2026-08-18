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
import { matchCategoryByValue } from '../src/lib/categoryMatch.js';

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
// Within-run handoff to summarize-changes.js, which turns it into the "Source
// health" section of the run notification. Deliberately at the repo root and
// not under data/: the workflow only commits data/, so this never lands in git
// (it is gitignored as well, for local runs).
const SOURCE_REPORT = path.resolve(__dirname, '../.pipeline-source-report.json');

// Error messages reach a GitHub issue, so keep them to the useful part: an
// API error body carries a whole JSON envelope and a request id that mean
// nothing to whoever reads the notification.
const brief = (msg) => String(msg).replace(/\s+/g, ' ').split(' {')[0].slice(0, 120).trim();
const today = () => new Date().toISOString().slice(0, 10);

function findByLabel(items, label) {
  if (!label) return undefined;
  const target = label.trim().toLowerCase();
  return items.find((i) => i.label.trim().toLowerCase() === target);
}

// Generic ISO-date-or-range parsing -- "YYYY-MM-DD" or "YYYY-MM-DD to
// YYYY-MM-DD" -- used only by the multi-day duplicate check below. Not
// races-specific: any vertical whose `date` core_fact can span multiple days
// (a multi-day conference, a hotel's promotional window) benefits from the
// same overlap logic.
function parseDateRange(dateStr) {
  if (typeof dateStr !== 'string') return null;
  const m = dateStr.match(/^(\d{4}-\d{2}-\d{2})(?:\s+to\s+(\d{4}-\d{2}-\d{2}))?$/);
  if (!m) return null;
  return [m[1], m[2] || m[1]];
}

function rangesOverlap(a, b) {
  return a[0] <= b[1] && b[0] <= a[1];
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

  // Categories a candidate must touch at least one of to be in scope (see
  // the guard inside the loop, and _discoveryRequiredCategoryIds_note).
  const requiredCategoryIds = sourceConfig?.discoveryRequiredCategoryIds ?? [];
  const requiredCategories = categories.filter((c) => requiredCategoryIds.includes(c.category_id));
  if (requiredCategoryIds.length > 0) {
    const missing = requiredCategoryIds.filter((id) => !requiredCategories.some((c) => c.category_id === id));
    if (missing.length > 0) {
      console.warn(`[discover-entities] discoveryRequiredCategoryIds names unknown category id(s): ${missing.join(', ')} -- ignored.`);
    }
    console.log(
      `[discover-entities] scope filter: candidate must offer a distance in ` +
        `${requiredCategories.map((c) => `${c.label} [${c.matchRange?.join('-')}]`).join(' or ')}.`
    );
  }

  const stats = { sourcesChecked: 0, sourcesSkipped: 0, candidatesFound: 0, written: 0, skipped: 0 };
  // Per-source outcome, written to SOURCE_REPORT at the end so
  // summarize-changes.js can report source health in the run notification.
  // Until this existed a source could 403 for weeks while the notification
  // still read a cheerful "0 added" -- four of them actually did (three
  // ahotu.com URLs and checkpointspot.asia, found by hand on 2026-08-18).
  const sourceOutcomes = [];
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
      sourceOutcomes.push({ url: sourceUrl, host: domain, ok: false, kind: 'source', reason: `robots.txt check failed: ${brief(err.message)}` });
      continue;
    }
    if (!allowed) {
      console.log(`[discover-entities] ${domain} disallows ${userAgent} via robots.txt -- skipping.`);
      stats.sourcesSkipped++;
      sourceOutcomes.push({ url: sourceUrl, host: domain, ok: false, kind: 'source', reason: 'disallowed by robots.txt' });
      continue;
    }

    await throttle(new URL(sourceUrl).hostname, delayMs);

    let html;
    try {
      html = await fetchText(sourceUrl, { userAgent });
    } catch (err) {
      console.warn(`[discover-entities] fetch failed for ${domain}: ${err.message}`);
      stats.sourcesSkipped++;
      sourceOutcomes.push({ url: sourceUrl, host: domain, ok: false, kind: 'source', reason: `fetch failed: ${brief(err.message)}` });
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
      sourceOutcomes.push({ url: sourceUrl, host: domain, ok: false, kind: 'pipeline', reason: `extraction call failed: ${brief(err.message)}` });
      continue;
    }
    if (!Array.isArray(candidates)) {
      console.warn(`[discover-entities] expected a JSON array from ${domain}, got ${typeof candidates} -- skipping.`);
      sourceOutcomes.push({ url: sourceUrl, host: domain, ok: false, kind: 'pipeline', reason: `unusable response (expected an array, got ${typeof candidates})` });
      continue;
    }

    stats.candidatesFound += candidates.length;
    sourceOutcomes.push({ url: sourceUrl, host: domain, ok: true, candidates: candidates.length });

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

      // Enforce the in-scope distance rule in code as well as in the prompt,
      // for the same reason the date window is checked twice above: a model
      // asked to extract every row of a running calendar hands back the
      // charity 5K sitting next to the marathon often enough to matter. On
      // 2026-08-18 five standalone 5K/10K fun runs were written this way,
      // against a directory where 183 of 187 races carry a 21.1km or longer
      // distance -- the exceptions were all from that one run.
      //
      // Vertical-agnostic: the acceptable ranges come from the matchRange on
      // the category records named in sourceConfig.discoveryRequiredCategoryIds,
      // so this script still contains no hardcoded distance logic. Skipped
      // entirely when that config key is absent or empty, and when the
      // vertical's core_facts has no numeric list to test.
      if (requiredCategories.length > 0) {
        const values = Object.values(coreFactsResult.data)
          .flatMap((v) => (Array.isArray(v) ? v : [v]))
          .filter((v) => typeof v === 'number' && !Number.isNaN(v));
        if (values.length > 0 && !values.some((v) => matchCategoryByValue(v, requiredCategories))) {
          stats.skipped++;
          skipReasons.push(
            `${domain}: "${candidate.name}" -- out of scope: no value in ${JSON.stringify(values)} falls in ` +
              `${requiredCategories.map((c) => c.label).join(' / ')} -- skipped`
          );
          continue;
        }
      }

      // The slug check above only catches the same event discovered under
      // (near-)identical names. Two real cases slipped through it in
      // practice, both now checked below, in order from most to least
      // specific:
      //
      // 1. Same distance/category, different name -- one aggregator lists a
      //    race by its generic name ("Bali Marathon") while another lists
      //    the same race by its sponsor-branded name ("Maybank Marathon").
      //    Same category + same region + same date is a strong signal, since
      //    a dated event has essentially one calendar slot.
      //
      // 2. Same multi-day festival, split into one entity per distance --
      //    an existing entity already models a multi-day event across all
      //    its distances (e.g. "Jakarta Running Festival 2026", date
      //    "2026-10-22 to 2026-10-25", category "full-marathon"), and a
      //    different source lists just its half-marathon leg as its own
      //    candidate (date "2026-10-24", category "half-marathon"). Exact
      //    category+date matching misses this entirely, so when either side
      //    of the comparison is a genuine multi-day range, same region +
      //    overlapping dates is checked instead, without requiring category
      //    to match. (Not widened to same-region + overlapping dates for
      //    two single-day candidates -- that's common enough on a busy
      //    country-level calendar to risk false-positiving two genuinely
      //    unrelated same-day races.)
      //
      // Both are guarded on `date` existing, same as the window check above,
      // so a dateless vertical is unaffected. Either match is logged with
      // the specific existing entity it matched, so a false positive is easy
      // to spot and add manually.
      if (typeof candidateDate === 'string') {
        const exactMatch = existingEntities.find(
          (e) => e.region_id === region.region_id && e.category_id === category.category_id && e.core_facts?.date === candidateDate
        );

        const candidateRange = parseDateRange(candidateDate);
        const overlapMatch =
          !exactMatch &&
          candidateRange &&
          existingEntities.find((e) => {
            const existingRange = parseDateRange(e.core_facts?.date);
            if (!existingRange || e.region_id !== region.region_id) return false;
            const eitherIsMultiDay = candidateRange[0] !== candidateRange[1] || existingRange[0] !== existingRange[1];
            return eitherIsMultiDay && rangesOverlap(candidateRange, existingRange);
          });

        const possibleDuplicate = exactMatch || overlapMatch;
        if (possibleDuplicate) {
          const reason = exactMatch
            ? `same category (${category.label}), region (${region.label}) and date (${candidateDate})`
            : `region (${region.label}) with overlapping dates (${candidateDate} vs existing ${possibleDuplicate.core_facts?.date})`;
          stats.skipped++;
          skipReasons.push(
            `${domain}: "${candidate.name}" -- ${reason} as existing "${possibleDuplicate.name}" (${possibleDuplicate.slug}) -- ` +
              `likely the same event (possibly one distance of a multi-distance festival), skipped. If this is genuinely a ` +
              `different event, add it manually.`
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

  try {
    fs.writeFileSync(SOURCE_REPORT, JSON.stringify({ sources: sourceOutcomes }, null, 2) + '\n');
  } catch (err) {
    console.warn(`[discover-entities] could not write the source report: ${err.message}`);
  }

  console.log(
    `\n[discover-entities] done. Sources checked: ${stats.sourcesChecked} (${stats.sourcesSkipped} skipped), ` +
      `candidates found: ${stats.candidatesFound}, written: ${stats.written}, skipped: ${stats.skipped}.`
  );
  const failedSources = sourceOutcomes.filter((o) => !o.ok);
  if (failedSources.length > 0) {
    console.warn(`\n[discover-entities] ${failedSources.length} of ${stats.sourcesChecked} source(s) unusable this run:`);
    for (const f of failedSources) console.warn(`  - ${f.url} -- ${f.reason}`);
  }
  if (skipReasons.length > 0) {
    console.log('\nSkip reasons:');
    for (const reason of skipReasons) console.log(`  - ${reason}`);
  }
}

run().catch((err) => {
  console.error('[discover-entities] fatal error:', err);
  process.exit(1);
});
