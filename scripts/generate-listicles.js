#!/usr/bin/env node
/**
 * generate-listicles.js
 *
 * Creates the "Best Of" guide pages by walking every category x region
 * combination that has enough entities to be worth a page, and writing a
 * listicle definition for each one it doesn't already have.
 *
 * WHY GENERATE THEM
 * A listicle here is not a hand-written article -- it's a filter plus an
 * editorial wrapper. src/lib/listicles.js resolves the filter against live
 * data at build time, so "Best Full Marathons in Thailand" re-ranks itself
 * every time the directory changes and can never go stale the way a
 * hand-maintained list does. That means the only thing actually worth
 * generating is the wrapper: title, intro, FAQs.
 *
 * WHAT MAKES A COMBINATION WORTH A PAGE
 * A guide listing two entries is a worse result than no guide at all -- it
 * reads as thin, and thin pages drag on a domain rather than helping it. So
 * a combination is only created once it clears minEntities. Combinations
 * that fall below the threshold are skipped and reported, not created empty
 * in the hope they fill up later.
 *
 * IDEMPOTENT BY DESIGN
 * An existing listicle file is never overwritten by the default (create)
 * pass. Once a guide exists its intro and FAQs may have been edited by
 * hand, and a weekly job that silently reverted those edits would be worse
 * than useless. Delete the file to have it regenerated.
 *
 * --refresh-stale
 * That idempotence had a cost nobody was paying attention to: the LIST in a
 * guide re-resolves from its filters every build, but the prose describing
 * it was written once and then never revisited. Guides drifted into stating
 * things that had stopped being true -- one opened "Every 10K on this list
 * falls in a single two-week window, August 15 to 30, 2026" as that window
 * was closing; another led with two races that had since been run and
 * archived off the site.
 *
 * So each guide now stores a fingerprint of the entity set its copy was
 * written against (listicleFingerprint, src/lib/listicles.js). Run with
 * --refresh-stale, this script re-resolves every guide, compares, and
 * rewrites the copy of the ones whose set has moved on. It is the same
 * generation call the create pass makes, so refreshed copy is written to the
 * same standard, and `filters`, `manual_entity_ids` and the guide's slug are
 * carried over untouched -- a refresh rewrites prose, never scope.
 *
 * Between refreshes the renderer covers the gap: src/pages/best/[slug].astro
 * detects the same staleness and falls back to a description derived from
 * live data, so a guide can never DISPLAY copy about races it isn't listing,
 * even if this script hasn't run since the set changed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import siteConfig from '../src/lib/config.js';
import { listicleSchema } from '../src/lib/schema/base.js';
import { loadEntities, loadCategories, loadRegions, stripMeta, isPublished, buildRegionAncestryMap } from '../src/lib/data.js';
import { entityMatchesCategory } from '../src/lib/categoryMatch.js';
import { resolveListicleEntities, listicleFingerprint, isListicleCopyStale } from '../src/lib/listicles.js';
import { slugify } from './lib/slugify.js';
import { callClaudeForJson } from './lib/anthropic-client.js';
import { buildListicleCopyPrompt } from './lib/prompts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LISTICLES_DIR = path.resolve(__dirname, '../data/listicles');
const today = () => new Date().toISOString().slice(0, 10);

const hasFlag = (name) => process.argv.includes(`--${name}`);

function argValue(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || i === process.argv.length - 1) return fallback;
  const parsed = Number(process.argv[i + 1]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function run() {
  const minEntities = argValue('min', siteConfig.listicleConfig?.minEntities ?? 4);
  const limit = argValue('limit', siteConfig.listicleConfig?.perRunLimit ?? 10);
  // Opt-in so the create pass keeps its old behaviour exactly; the weekly
  // workflow passes it (see .github/workflows/weekly-refresh.yml).
  const refreshStale = hasFlag('refresh-stale');

  const entities = loadEntities().map(stripMeta).filter(isPublished);
  const categories = loadCategories().map(stripMeta).filter(isPublished);
  const regions = loadRegions().map(stripMeta).filter(isPublished);
  const ancestry = buildRegionAncestryMap(regions);
  const topLevelRegions = regions.filter((r) => !r.parent_region_id);

  if (!fs.existsSync(LISTICLES_DIR)) fs.mkdirSync(LISTICLES_DIR, { recursive: true });
  const existingFiles = fs.readdirSync(LISTICLES_DIR).filter((f) => f.endsWith('.json'));
  const existingSlugs = new Set(existingFiles.map((f) => f.replace(/\.json$/, '')));

  // Dedupe on what a guide *covers*, not what it's called. "Best Full
  // Marathons in Thailand" and "Best Full Marathon Races in Thailand" are
  // different slugs but the same page: two URLs targeting one query, each
  // splitting the other's ranking. Comparing the resolved filter catches
  // that, where a slug comparison would happily create both.
  const filterKey = (f = {}) => `${f.category_id ?? '*'}|${f.region_id ?? '*'}|${(f.tags_any ?? []).join('+')}`;
  const coveredFilters = new Set(
    existingFiles.map((f) => {
      try {
        return filterKey(JSON.parse(fs.readFileSync(path.join(LISTICLES_DIR, f), 'utf8')).filters);
      } catch {
        return null;
      }
    }).filter(Boolean)
  );

  const inRegion = (entity, regionId) => (ancestry.get(entity.region_id) ?? [entity.region_id]).includes(regionId);

  // Candidate set: every category on its own (site-wide), plus every
  // category x country pairing. Region-only guides are deliberately not
  // generated -- the region hub page already is that list, and a guide
  // duplicating it competes with it in search rather than adding anything.
  const candidates = [];
  for (const category of categories) {
    candidates.push({
      key: `${category.slug}-${siteConfig.siteDomain.split('.')[0]}`,
      title_hint: `${category.label} across ${siteConfig.siteName}`,
      slug: slugify(`best ${category.label} ${siteConfig.entityLabelPlural}`),
      filters: { category_id: category.category_id },
      // Union membership, the same rule the hubs and the guide pages use
      // (entityMatchesCategory): a race offering 42.195/21.1/10/5 km belongs
      // to four distance types, not just its marquee one. Counting only the
      // marquee category here meant a "Best 5K races" guide could never clear
      // minEntities -- no event's headline distance is 5K -- while the 5K hub
      // listed 130 of them.
      matched: entities.filter((e) => entityMatchesCategory(e, category, categories)),
      category,
      region: null,
    });
    for (const region of topLevelRegions) {
      candidates.push({
        slug: slugify(`best ${category.label} ${siteConfig.entityLabelPlural} in ${region.label}`),
        filters: { category_id: category.category_id, region_id: region.region_id },
        matched: entities.filter((e) => entityMatchesCategory(e, category, categories) && inRegion(e, region.region_id)),
        category,
        region,
      });
    }
  }

  const isNew = (c) => !existingSlugs.has(c.slug) && !coveredFilters.has(filterKey(c.filters));

  const eligible = candidates.filter((c) => isNew(c) && c.matched.length >= minEntities).sort((a, b) => b.matched.length - a.matched.length);

  const tooThin = candidates.filter((c) => isNew(c) && c.matched.length < minEntities).length;
  const alreadyCovered = candidates.filter((c) => !isNew(c)).length;

  console.log(
    `[generate-listicles] ${candidates.length} combinations considered, ` +
      `${alreadyCovered} already covered by an existing guide, ${tooThin} below the ${minEntities}-entry ` +
      `threshold, ${eligible.length} eligible. Creating up to ${limit}.`
  );

  const stats = { created: 0, failed: 0, invalid: 0 };

  for (const candidate of eligible.slice(0, limit)) {
    const { system, prompt } = buildListicleCopyPrompt({
      siteConfig,
      category: candidate.category,
      region: candidate.region,
      matched: candidate.matched,
    });

    let copy;
    try {
      copy = await callClaudeForJson({ system, prompt, maxTokens: 1500 });
    } catch (err) {
      console.warn(`[generate-listicles] ${candidate.slug}: copy generation failed: ${err.message} -- skipping.`);
      stats.failed++;
      continue;
    }

    const listicle = {
      listicle_id: candidate.slug,
      slug: candidate.slug,
      title: typeof copy?.title === 'string' && copy.title.trim() ? copy.title.trim() : defaultTitle(candidate, siteConfig),
      intro: typeof copy?.intro === 'string' ? copy.intro.trim() : '',
      filters: {
        ...candidate.filters,
        // Soonest first. Ranking a "best of" list by an internal confidence
        // score would be dishonest to the page's own title, and date order
        // is the ordering a reader of an events guide actually wants.
        sort_by: 'date',
        sort_direction: 'asc',
        limit: 15,
      },
      manual_entity_ids: [],
      editorial_notes: `Auto-generated by scripts/generate-listicles.js on ${today()}. The entity list is resolved from the filters at build time, so it stays current without edits. Title/intro/FAQs are safe to edit by hand -- this script never overwrites an existing file.`,
      faqs: Array.isArray(copy?.faqs)
        ? copy.faqs
            .filter((f) => f && typeof f.question === 'string' && typeof f.answer === 'string')
            .slice(0, 3)
            .map((f) => ({ question: f.question.trim(), answer: f.answer.trim() }))
        : [],
      last_updated: today(),
      copy_generated_at: today(),
      // Created active, not draft. The pipeline commits straight to main, so
      // there is no pull-request stage where a human would promote a draft --
      // anything left as draft would simply never appear, and the weekly
      // notification would report guides that don't exist. Review happens
      // after the fact instead: the run summary lists every new guide, and
      // any that reads badly can be edited or deleted from the live site.
      status: 'active',
    };

    // Stamp the set the copy above was written about. Resolved through the
    // very same helper the guide page uses, so what is fingerprinted is
    // exactly what will render -- filters, pins, sort and limit included.
    listicle.source_fingerprint = listicleFingerprint(
      resolveListicleEntities(listicle, entities, regions, categories)
    );

    const validation = listicleSchema.safeParse(listicle);
    if (!validation.success) {
      console.warn(
        `[generate-listicles] ${candidate.slug}: failed schema validation, NOT writing: ${validation.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`
      );
      stats.invalid++;
      continue;
    }

    fs.writeFileSync(path.join(LISTICLES_DIR, `${candidate.slug}.json`), JSON.stringify(validation.data, null, 2) + '\n');
    existingSlugs.add(candidate.slug);
    coveredFilters.add(filterKey(candidate.filters));
    stats.created++;
    console.log(`[generate-listicles] created ${candidate.slug} (${candidate.matched.length} matching entries).`);
  }

  console.log(`\n[generate-listicles] done. Created: ${stats.created}, failed: ${stats.failed}, invalid: ${stats.invalid}.`);

  if (refreshStale) {
    await refreshStaleGuides({ entities, categories, regions, limit });
  }
}

/**
 * Rewrites the prose of every guide whose entity set has moved on since that
 * prose was written.
 *
 * Only the written parts change: title, intro, FAQs, and the fingerprint
 * recording what they were written about. `filters`, `manual_entity_ids`,
 * `slug` and `status` are carried straight through, because a refresh is a
 * re-description of the same guide, not a redefinition of it.
 *
 * An `editorial_pick` is kept only if the race it names is still in the set.
 * The copy prompt doesn't produce picks, so a refresh can't rewrite one --
 * but silently keeping "Our top pick is the Bintulu Marathon" on a guide that
 * no longer lists Bintulu is the exact failure this whole mechanism exists to
 * stop, so an orphaned pick is dropped rather than carried.
 */
async function refreshStaleGuides({ entities, categories, regions, limit }) {
  const categoriesById = new Map(categories.map((c) => [c.category_id, c]));
  const regionsById = new Map(regions.map((r) => [r.region_id, r]));

  const stored = fs
    .readdirSync(LISTICLES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ file: f, listicle: JSON.parse(fs.readFileSync(path.join(LISTICLES_DIR, f), 'utf8')) }));

  const stale = stored
    .map((entry) => ({ ...entry, resolved: resolveListicleEntities(entry.listicle, entities, regions, categories) }))
    .filter((entry) => isListicleCopyStale(entry.listicle, entry.resolved))
    // A guide that has emptied out entirely has nothing to write copy from;
    // leave it alone (the page renders its own empty state) rather than
    // asking the model to describe an empty list.
    .filter((entry) => entry.resolved.length > 0);

  console.log(
    `\n[generate-listicles] --refresh-stale: ${stored.length} guides on disk, ${stale.length} describing a set ` +
      `that has changed. Refreshing up to ${limit}.`
  );

  const stats = { refreshed: 0, failed: 0, invalid: 0 };

  for (const { file, listicle, resolved } of stale.slice(0, limit)) {
    const category = categoriesById.get(listicle.filters?.category_id);
    const region = listicle.filters?.region_id ? regionsById.get(listicle.filters.region_id) : null;
    if (!category) {
      console.warn(`[generate-listicles] ${listicle.slug}: no category for filter "${listicle.filters?.category_id}" -- skipping refresh.`);
      stats.failed++;
      continue;
    }

    let copy;
    try {
      copy = await callClaudeForJson({
        ...buildListicleCopyPrompt({ siteConfig, category, region, matched: resolved }),
        maxTokens: 1500,
      });
    } catch (err) {
      console.warn(`[generate-listicles] ${listicle.slug}: refresh failed: ${err.message} -- leaving as-is.`);
      stats.failed++;
      continue;
    }

    const pickStillValid =
      typeof listicle.editorial_pick === 'string' && resolved.some((e) => listicle.editorial_pick.includes(e.name));

    const refreshed = {
      ...listicle,
      title: typeof copy?.title === 'string' && copy.title.trim() ? copy.title.trim() : listicle.title,
      intro: typeof copy?.intro === 'string' && copy.intro.trim() ? copy.intro.trim() : listicle.intro,
      faqs: Array.isArray(copy?.faqs)
        ? copy.faqs
            .filter((f) => f && typeof f.question === 'string' && typeof f.answer === 'string')
            .slice(0, 3)
            .map((f) => ({ question: f.question.trim(), answer: f.answer.trim() }))
        : listicle.faqs,
      source_fingerprint: listicleFingerprint(resolved),
      copy_generated_at: today(),
      last_updated: today(),
    };
    if (!pickStillValid) delete refreshed.editorial_pick;

    const validation = listicleSchema.safeParse(refreshed);
    if (!validation.success) {
      console.warn(
        `[generate-listicles] ${listicle.slug}: refreshed copy failed validation, NOT writing: ${validation.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`
      );
      stats.invalid++;
      continue;
    }

    fs.writeFileSync(path.join(LISTICLES_DIR, file), JSON.stringify(validation.data, null, 2) + '\n');
    stats.refreshed++;
    console.log(`[generate-listicles] refreshed ${listicle.slug} (${resolved.length} entries).`);
  }

  console.log(
    `[generate-listicles] --refresh-stale done. Refreshed: ${stats.refreshed}, failed: ${stats.failed}, invalid: ${stats.invalid}.`
  );
}

function defaultTitle(candidate, config) {
  const where = candidate.region ? ` in ${candidate.region.label}` : '';
  return `Best ${candidate.category.label} ${config.entityLabelPlural}${where}`;
}

run().catch((err) => {
  console.error('[generate-listicles] fatal:', err);
  process.exitCode = 1;
});
