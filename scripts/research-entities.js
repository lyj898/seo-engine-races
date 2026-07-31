#!/usr/bin/env node
/**
 * research-entities.js
 *
 * Third stage of the weekly pipeline, sitting between `refresh` and
 * `summaries`: goes out to the open web and gathers first-hand commentary
 * about each published entity -- quotes, highlights, caveats, sentiment --
 * and stores it on the entity for the summary writer to build prose from.
 *
 * WHY THIS EXISTS
 * The discover/refresh stages only ever see aggregator listing pages and
 * official event sites. Those state facts (date, distance, venue) and
 * nothing more, so a summary generated from them can only restate the same
 * facts back. That's what made every listing read like a verification
 * receipt rather than something worth reading. This stage supplies the
 * missing raw material; `generate-summaries.js` then has something real to
 * write from.
 *
 * WHAT IT WILL NOT DO
 *   - It never touches core_facts. Facts stay owned by the refresh stage,
 *     which validates them against a named source page. Research output is
 *     opinion and colour, and it is kept in its own fields so the two can
 *     never be confused.
 *   - It never invents a quote. Any returned quote without a usable
 *     source_url is dropped here rather than trusted, because an
 *     unattributable "review" is indistinguishable from a fabricated one.
 *   - It never changes an entity's status. Publishing decisions stay with
 *     the human reviewing the pull request.
 *
 * COST CONTROL
 * Web search costs real money per entity, and the useful material about a
 * given event does not change week to week. So an entity is re-researched
 * only when it has never been researched, or when its stored research is
 * older than sourceConfig.researchIntervalDays. `--limit` caps how many
 * entities a single run will process, keeping any one run's spend bounded
 * and predictable.
 */
import siteConfig from '../src/lib/config.js';
import { getEntitySchema } from '../src/lib/schema/index.js';
import { loadEntities, stripMeta, isPublished } from '../src/lib/data.js';
import { writeIfValid } from './lib/write-entity.js';
import { callClaudeWithWebSearchForJson } from './lib/anthropic-client.js';
import { buildResearchPrompt } from './lib/prompts.js';

const today = () => new Date().toISOString().slice(0, 10);

function daysBetween(isoA, isoB) {
  const a = Date.parse(isoA);
  const b = Date.parse(isoB);
  if (Number.isNaN(a) || Number.isNaN(b)) return Infinity;
  return Math.abs(b - a) / 86400000;
}

/** Reads `--flag value` style args without pulling in a CLI dependency. */
function argValue(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || i === process.argv.length - 1) return fallback;
  const parsed = Number(process.argv[i + 1]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function run() {
  const { verticalKey, sourceConfig } = siteConfig;
  const entitySchema = getEntitySchema(verticalKey);
  const intervalDays = sourceConfig?.researchIntervalDays ?? 90;
  const limit = argValue('limit', sourceConfig?.researchPerRunLimit ?? 25);

  const raw = loadEntities();
  const stats = { considered: 0, researched: 0, skippedFresh: 0, noMaterial: 0, failed: 0, invalidSkipped: 0 };

  // Nearest events first: an entity people are about to make a decision
  // about is the one worth spending a search on. A race 11 months out will
  // come round on a later run, by which time there is more written about it
  // anyway.
  const targets = raw
    .filter((r) => isPublished(stripMeta(r)))
    .sort((a, b) => String(a.core_facts?.date ?? '').localeCompare(String(b.core_facts?.date ?? '')));

  const queue = [];
  for (const item of targets) {
    const entity = stripMeta(item);
    stats.considered++;
    const lastResearched = entity.research_last_updated;
    if (lastResearched && daysBetween(lastResearched, today()) < intervalDays) {
      stats.skippedFresh++;
      continue;
    }
    queue.push(item);
    if (queue.length >= limit) break;
  }

  console.log(
    `[research-entities] ${stats.considered} published, ${stats.skippedFresh} still fresh ` +
      `(< ${intervalDays} days), researching ${queue.length} this run (limit ${limit}).`
  );

  for (const item of queue) {
    const entity = stripMeta(item);
    const { system, prompt } = buildResearchPrompt({ siteConfig, entity });

    let result;
    try {
      result = await callClaudeWithWebSearchForJson({ system, prompt, maxTokens: 2500 });
    } catch (err) {
      console.warn(`[research-entities] ${entity.slug}: research call failed: ${err.message} -- leaving unchanged.`);
      stats.failed++;
      continue;
    }

    // Attribution gate: a quote we cannot point at is dropped, not stored.
    const quotes = Array.isArray(result?.excerpt_quotes)
      ? result.excerpt_quotes
          .filter((q) => q && typeof q.quote === 'string' && q.quote.trim() && typeof q.attribution === 'string')
          .filter((q) => {
            if (typeof q.source_url !== 'string') return false;
            try {
              new URL(q.source_url);
              return true;
            } catch {
              return false;
            }
          })
          .map((q) => ({
            quote: q.quote.trim().slice(0, 400),
            attribution: q.attribution.trim(),
            source_url: q.source_url,
          }))
      : [];

    const strings = (value, max) =>
      Array.isArray(value) ? value.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim()).slice(0, max) : [];

    const highlights = strings(result?.highlights, 5);
    const watchouts = strings(result?.watchouts, 4);

    if (quotes.length === 0 && highlights.length === 0 && watchouts.length === 0) {
      // Still stamp the date: without it this entity would be retried on
      // every single run, spending a search each time to learn the same
      // nothing. It will come round again after the normal interval.
      const stamped = { ...entity, research_last_updated: today() };
      if (writeIfValid(item.__file, stamped, entitySchema)) stats.noMaterial++;
      else stats.invalidSkipped++;
      continue;
    }

    const sentiment =
      result?.sentiment_scores && typeof result.sentiment_scores.overall === 'number'
        ? result.sentiment_scores
        : entity.sentiment_scores;

    const updated = {
      ...entity,
      excerpt_quotes: quotes.length > 0 ? quotes : entity.excerpt_quotes,
      research_highlights: highlights,
      research_watchouts: watchouts,
      ...(sentiment ? { sentiment_scores: sentiment } : {}),
      research_confidence: typeof result?.research_confidence === 'string' ? result.research_confidence : undefined,
      research_last_updated: today(),
      last_updated: today(),
    };

    if (writeIfValid(item.__file, updated, entitySchema)) {
      stats.researched++;
      console.log(
        `[research-entities] ${entity.slug}: ${quotes.length} quote(s), ${highlights.length} highlight(s), ${watchouts.length} watchout(s).`
      );
    } else {
      stats.invalidSkipped++;
    }
  }

  console.log(
    `\n[research-entities] done. Researched: ${stats.researched}, nothing found: ${stats.noMaterial}, ` +
      `already fresh: ${stats.skippedFresh}, failed: ${stats.failed}, invalid (skipped write): ${stats.invalidSkipped}.`
  );
}

run().catch((err) => {
  console.error('[research-entities] fatal:', err);
  process.exitCode = 1;
});
