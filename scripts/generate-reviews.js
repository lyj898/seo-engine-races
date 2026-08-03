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
import { loadEntities, loadReviews, stripMeta, isPublished } from '../src/lib/data.js';
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

/** Shape the model's raw JSON into a review record with fields we control. */
function normalizeReview(entity, result) {
  const sections = Array.isArray(result?.sections)
    ? result.sections
        .filter((s) => s && isNonEmptyString(s.heading) && Array.isArray(s.paragraphs))
        .map((s) => ({
          heading: s.heading.trim(),
          paragraphs: s.paragraphs.filter(isNonEmptyString).map((p) => p.trim()),
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
    verdict: isNonEmptyString(result?.verdict) ? result.verdict.trim() : '',
    ...(rating ? { rating } : {}),
    sections,
    pull_quotes,
    sources,
    faqs,
    editorial_notes: `Auto-generated by scripts/generate-reviews.js on ${today()}. Prose is original synthesis; quotes are short attributed excerpts. Safe to hand-edit -- this script never overwrites an existing review.`,
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

  const entities = loadEntities().map(stripMeta).filter(isPublished);
  const reviewedEntityIds = new Set(loadReviews().map(stripMeta).map((r) => r.entity_id));

  const missing = entities.filter((e) => !reviewedEntityIds.has(e.entity_id));
  // Prefer entities we already have material on -- a review needs substance.
  const withMaterial = missing.filter((e) => materialScore(e) >= 2);
  const pool = withMaterial.length > 0 ? withMaterial : missing;

  const t = today();
  const upcoming = pool
    .filter((e) => typeof e.core_facts?.date === 'string' && e.core_facts.date >= t)
    .sort((a, b) => a.core_facts.date.localeCompare(b.core_facts.date));
  const rest = pool.filter((e) => !(typeof e.core_facts?.date === 'string' && e.core_facts.date >= t));
  const queue = [...upcoming, ...rest].slice(0, limit);

  console.log(
    `[generate-reviews] ${entities.length} published, ${reviewedEntityIds.size} already reviewed, ` +
      `${missing.length} without a review. Writing up to ${limit} this run.`
  );

  const stats = { written: 0, skippedInvalid: 0, skippedUncited: 0, failed: 0, noSubstance: 0 };

  for (const entity of queue) {
    const { system, prompt } = buildReviewArticlePrompt({ siteConfig, entity });

    let result;
    try {
      result = await callClaudeWithWebSearchForJson({ system, prompt, maxTokens: 5000, maxSearches: 6 });
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
