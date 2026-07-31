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
 * An existing listicle file is never overwritten. Once a guide exists its
 * intro and FAQs may have been edited by hand, and a weekly job that
 * silently reverted those edits would be worse than useless. Delete the
 * file to have it regenerated.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import siteConfig from '../src/lib/config.js';
import { listicleSchema } from '../src/lib/schema/base.js';
import { loadEntities, loadCategories, loadRegions, stripMeta, isPublished, buildRegionAncestryMap } from '../src/lib/data.js';
import { slugify } from './lib/slugify.js';
import { callClaudeForJson } from './lib/anthropic-client.js';
import { buildListicleCopyPrompt } from './lib/prompts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LISTICLES_DIR = path.resolve(__dirname, '../data/listicles');
const today = () => new Date().toISOString().slice(0, 10);

function argValue(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || i === process.argv.length - 1) return fallback;
  const parsed = Number(process.argv[i + 1]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function run() {
  const minEntities = argValue('min', siteConfig.listicleConfig?.minEntities ?? 4);
  const limit = argValue('limit', siteConfig.listicleConfig?.perRunLimit ?? 10);

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
      matched: entities.filter((e) => e.category_id === category.category_id),
      category,
      region: null,
    });
    for (const region of topLevelRegions) {
      candidates.push({
        slug: slugify(`best ${category.label} ${siteConfig.entityLabelPlural} in ${region.label}`),
        filters: { category_id: category.category_id, region_id: region.region_id },
        matched: entities.filter((e) => e.category_id === category.category_id && inRegion(e, region.region_id)),
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
      // Created as draft: a generated page should be read once before it
      // goes live, and the pull request is where that happens.
      status: 'draft',
    };

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
}

function defaultTitle(candidate, config) {
  const where = candidate.region ? ` in ${candidate.region.label}` : '';
  return `Best ${candidate.category.label} ${config.entityLabelPlural}${where}`;
}

run().catch((err) => {
  console.error('[generate-listicles] fatal:', err);
  process.exitCode = 1;
});
