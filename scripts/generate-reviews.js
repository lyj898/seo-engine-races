#!/usr/bin/env node
/**
 * generate-reviews.js
 *
 * Writes ONE long-form review article per run (data/reviews/*.json) for a
 * published entity that doesn't have one yet -- the daily counterpart to the
 * weekly entity pipeline. It reuses the same web-search-backed model call the
 * research stage uses, and the same "validate before you write" discipline as
 * every other stage.
 *
 * WHAT IT WILL NOT DO
 *   - It never overwrites an existing review. A hand-edited article is safe
 *     forever; this only ever creates the missing ones.
 *   - It never writes an article whose [n] citations don't all resolve to a
 *     declared source, or that fails the review schema. A shaky draft costs
 *     one skipped run and a log line, never a broken build or an uncited
 *     claim on the live site.
 *
 * SELECTION / COST
 *   One article per run by default (sourceConfig.reviewPerRunLimit). Entities
 *   with real research material on file are preferred (a review needs
 *   substance), and upcoming events are chosen before past ones -- the review
 *   is most useful while people can still enter. Lapsed events still get
 *   reviewed eventually; the review page links forward to the next edition.
 */
import siteConfig from '../src/lib/config.js';
import { reviewSchema } from '../src/lib/schema/index.js';
import { loadEntities, loadReviews, loadRegions, stripMeta, isPublished, buildRegionAncestryMap } from '../src/lib/data.js';
import { writeIfValid } from './lib/write-entity.js';
import { callClaudeWithWebSearchForJson } from './lib/anthropic-client.js';
import { buildReviewArticlePrompt } from './lib/prompts.js';

const today = () => new Date().toISOString().slice(0, 10);

function argValue(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || i === process.argv.length - 1) return fallback;
  const parsed = Number(process.argv[i + 1]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Reads a `--flag value` string arg (for slugs/region targeting). */
function argString(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || i === process.argv.length - 1) return fallback;
  return String(process.argv[i + 1]);
}

const SOURCE_TYPES = new Set(['official', 'registration_platform', 'aggregator', 'review', 'social', 'news', 'other']);

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
const validUrl = (v) => {
  if (typeof v !== 'string') return false;
  try {
    new URL(v);
    return true;
  } catch {
    return false;
  }
};

/** How much first-hand material we already hold on an entity. */
function materialScore(entity) {
  return (
    (entity.excerpt_quotes?.length ?? 0) +
    (entity.research_highlights?.length ?? 0) +
    (entity.research_watchouts?.length ?? 0)
  );
}

// Strip web-search citation artifacts the model sometimes leaks into prose:
// <cite> wrapper tags and compound/hyphenated refs like [16-8] that point at
// internal retrieval chunks instead of our sources[]. validate-data also
// rejects these, but scrubbing here keeps a single leak from failing a whole
// run's post-validate.
const stripLeakedArtifacts = (s) =>
  s
    .replace(/<\/?cite[^>]*>/gi, '')
    .replace(/\[\d+-[^\]]*\]/g, '') // hyphenated chunk refs only; [n] and [n,m] are valid
    .replace(/\s{2,}/g, ' ')
    .trim();

const wordCount = (s) => s.trim().split(/\s+/).filter(Boolean).length;

/** Shape the model's raw JSON into a review record with fields we control. */
function normalizeReview(entity, result) {
  const sections = Array.isArray(result?.sections)
    ? result.sections
        .filter((s) => s && isNonEmptyString(s.heading) && Array.isArray(s.paragraphs))
        .map((s) => ({
          heading: stripLeakedArtifacts(s.heading),
          paragraphs: s.paragraphs.filter(isNonEmptyString).map((p) => stripLeakedArtifacts(p)).filter((p) => p.length > 0),
        }))
        .filter((s) => s.paragraphs.length > 0)
    : [];

  const sources = Array.isArray(result?.sources)
    ? result.sources
        .filter((s) => s && Number.isInteger(s.n) && s.n > 0 && isNonEmptyString(s.label) && validUrl(s.url))
        .map((s) => ({
          n: s.n,
          label: s.label.trim(),
          ...(isNonEmptyString(s.publisher) ? { publisher: s.publisher.trim() } : {}),
          url: s.url,
          type: SOURCE_TYPES.has(s.type) ? s.type : 'other',
        }))
    : [];

  const pull_quotes = Array.isArray(result?.pull_quotes)
    ? result.pull_quotes
        .filter((q) => q && isNonEmptyString(q.quote) && isNonEmptyString(q.attribution) && validUrl(q.source_url))
        // Drop over-long verbatim quotes: a "pull quote" past ~28 words is a
        // copied passage, not a short attributed excerpt (fair-use / length).
        .filter((q) => wordCount(q.quote) <= 28)
        .slice(0, 3)
        .map((q) => ({ quote: q.quote.trim().slice(0, 400), attribution: q.attribution.trim(), source_url: q.source_url }))
    : [];

  const faqs = Array.isArray(result?.faqs)
    ? result.faqs.filter((f) => f && isNonEmptyString(f.question) && isNonEmptyString(f.answer)).map((f) => ({ question: f.question.trim(), answer: f.answer.trim() }))
    : [];

  const rating =
    result?.rating && typeof result.rating.overall === 'number'
      ? {
          overall: result.rating.overall,
          breakdown: Array.isArray(result.rating.breakdown)
            ? result.rating.breakdown
                .filter((b) => b && isNonEmptyString(b.label) && typeof b.score === 'number')
                .map((b) => ({ label: b.label.trim(), score: b.score }))
            : [],
        }
      : undefined;

  return {
    review_id: entity.slug,
    slug: entity.slug,
    entity_id: entity.entity_id,
    title: isNonEmptyString(result?.title) ? result.title.trim() : `${entity.name} review`,
    ...(isNonEmptyString(result?.seo_title) ? { seo_title: result.seo_title.trim().slice(0, 70) } : {}),
    ...(isNonEmptyString(result?.meta_description) ? { meta_description: result.meta_description.trim().slice(0, 200) } : {}),
    dek: isNonEmptyString(result?.dek) ? result.dek.trim() : entity.short_description,
    verdict: isNonEmptyString(result?.verdict) ? stripLeakedArtifacts(result.verdict) : '',
    ...(rating ? { rating } : {}),
    sections,
    pull_quotes,
    sources,
    faqs,
    editorial_notes: `Auto-generated by scripts/generate-reviews.js on ${today()}. Prose is original synthesis; quotes are short attributed excerpts. Safe to hand-edit -- this script never overwrites an existing review.`,
    published_at: new Date().toISOString(),
    last_updated: today(),
    status: 'active',
  };
}

/** Every [n] used in the body must resolve to a declared source. */
function citationsResolve(review) {
  const declared = new Set(review.sources.map((s) => s.n));
  for (const section of review.sections) {
    for (const para of section.paragraphs) {
      for (const match of para.matchAll(/\[(\d+)\]/g)) {
        if (!declared.has(Number(match[1]))) return false;
      }
    }
  }
  return true;
}

async function run() {
  const limit = argValue('limit', siteConfig.sourceConfig?.reviewPerRunLimit ?? 1);
  const explicitSlugs = argString('slugs').split(',').map((s) => s.trim()).filter(Boolean);
  const regionArg = argString('region').trim();
  const force = process.argv.includes('--force');
  const minIntervalHours = siteConfig.sourceConfig?.reviewMinIntervalHours ?? 11;

  const entities = loadEntities().map(stripMeta).filter(isPublished);
  const existingReviews = loadReviews().map(stripMeta);
  const reviewedEntityIds = new Set(existingReviews.map((r) => r.entity_id));

  // Never re-review; a hand-edited article must survive every run.
  const missing = entities.filter((e) => !reviewedEntityIds.has(e.entity_id));

  let queue;
  if (explicitSlugs.length > 0) {
    // Targeted mode: review exactly these entities, in the order given.
    // Slugs that don't exist, aren't published, or already have a review are
    // skipped with a note rather than failing the run.
    const bySlug = new Map(missing.map((e) => [e.slug, e]));
    queue = [];
    for (const slug of explicitSlugs) {
      const entity = bySlug.get(slug);
      if (entity) queue.push(entity);
      else console.log(`[generate-reviews] target "${slug}" skipped (unknown, unpublished, or already reviewed).`);
    }
    console.log(`[generate-reviews] targeted mode: ${queue.length} of ${explicitSlugs.length} requested slug(s) eligible.`);
  } else {
    // Self-healing pacing: the workflow ticks hourly (GitHub drops/delays
    // scheduled runs, so frequent ticks + this guard beat a twice-a-day cron).
    // Only actually generate when it's been >= reviewMinIntervalHours since the
    // most recent published review, which yields ~2/day regardless of which
    // ticks fire. A manual `--force` or a `--slugs` target bypasses this.
    if (!force) {
      const lastTs = existingReviews
        .map((r) => Date.parse(r.published_at ?? ''))
        .filter((t) => Number.isFinite(t))
        .sort((a, b) => b - a)[0];
      if (lastTs) {
        const hoursSince = (Date.now() - lastTs) / 3_600_000;
        if (hoursSince < minIntervalHours) {
          console.log(
            `[generate-reviews] last review published ${hoursSince.toFixed(1)}h ago ` +
              `(< ${minIntervalHours}h min interval); nothing to do this run.`
          );
          return;
        }
      }
    }

    // Auto mode: prefer entities we already hold material on (a review needs
    // substance), optionally scoped to one region (+ its child regions), then
    // soonest-upcoming first, capped at limit.
    let pool = missing;
    if (regionArg) {
      const ancestry = buildRegionAncestryMap(loadRegions().map(stripMeta));
      pool = pool.filter((e) => (ancestry.get(e.region_id) ?? [e.region_id]).includes(regionArg));
    }
    const withMaterial = pool.filter((e) => materialScore(e) >= 2);
    pool = withMaterial.length > 0 ? withMaterial : pool;

    const t = today();
    const upcoming = pool
      .filter((e) => typeof e.core_facts?.date === 'string' && e.core_facts.date >= t)
      .sort((a, b) => a.core_facts.date.localeCompare(b.core_facts.date));
    const rest = pool.filter((e) => !(typeof e.core_facts?.date === 'string' && e.core_facts.date >= t));
    queue = [...upcoming, ...rest].slice(0, limit);

    console.log(
      `[generate-reviews] ${entities.length} published, ${reviewedEntityIds.size} already reviewed, ` +
        `${missing.length} without a review${regionArg ? ` (${pool.length} in region "${regionArg}")` : ''}. ` +
        `Writing up to ${limit} this run.`
    );
  }

  const stats = { written: 0, skippedInvalid: 0, skippedUncited: 0, failed: 0, noSubstance: 0 };

  for (const entity of queue) {
    const { system, prompt } = buildReviewArticlePrompt({ siteConfig, entity });

    let result;
    try {
      // Generous ceiling. The model's web-search tool turns are themselves
      // output tokens, so a less-covered race that triggers many searches can
      // exhaust the budget before it finishes writing the JSON (seen at 8000
      // on an obscure event: truncated at meta_description). max_tokens is a
      // cap, not a spend, so we set it high enough that the JSON always fits
      // after the searches.
      result = await callClaudeWithWebSearchForJson({ system, prompt, maxTokens: 16000, maxSearches: 6 });
    } catch (err) {
      console.warn(`[generate-reviews] ${entity.slug}: model call failed: ${err.message} -- skipping.`);
      stats.failed++;
      continue;
    }

    const review = normalizeReview(entity, result);

    // Hard gates BEFORE writing -- these mirror validate-data.js's review
    // checks, so a run never produces data that would fail the post-validate.
    if (review.sources.length === 0 || review.sections.length === 0 || !review.verdict) {
      console.warn(`[generate-reviews] ${entity.slug}: model returned too little to publish -- skipping.`);
      stats.noSubstance++;
      continue;
    }
    if (!citationsResolve(review)) {
      console.warn(`[generate-reviews] ${entity.slug}: article had an unresolvable [n] citation -- skipping.`);
      stats.skippedUncited++;
      continue;
    }

    const filePath = `data/reviews/${entity.slug}.json`;
    if (writeIfValid(filePath, review, reviewSchema, 'generate-reviews')) {
      stats.written++;
      console.log(`[generate-reviews] ${entity.slug}: wrote review (${review.sections.length} sections, ${review.sources.length} sources, ${review.pull_quotes.length} quotes).`);
    } else {
      stats.skippedInvalid++;
    }
  }

  console.log(
    `\n[generate-reviews] done. Written: ${stats.written}, skipped (schema): ${stats.skippedInvalid}, ` +
      `skipped (uncited): ${stats.skippedUncited}, skipped (thin): ${stats.noSubstance}, failed: ${stats.failed}.`
  );
}

run().catch((err) => {
  console.error('[generate-reviews] fatal:', err);
  process.exitCode = 1;
});
