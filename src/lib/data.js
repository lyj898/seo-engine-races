import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = path.resolve(__dirname, '../../data');

/**
 * Shared, dependency-free data loader used by both Astro pages at build
 * time (Step 4) and by plain-Node scripts (validate-data.js and friends).
 * Deliberately has no Astro-specific imports so it works in both contexts.
 */
function readJsonDir(dirName) {
  const dir = path.join(DATA_ROOT, dirName);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const raw = fs.readFileSync(path.join(dir, f), 'utf8');
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        throw new Error(`Invalid JSON in data/${dirName}/${f}: ${err.message}`);
      }
      // __file is metadata for error messages / debugging -- strip it
      // before validating or rendering (schemas don't define it, so
      // zod's default .strict()-free objects would otherwise pass it
      // through silently).
      return { __file: `data/${dirName}/${f}`, ...parsed };
    });
}

export function loadEntities() {
  return readJsonDir('entities');
}
export function loadCategories() {
  return readJsonDir('categories');
}
export function loadRegions() {
  return readJsonDir('regions');
}
export function loadListicles() {
  return readJsonDir('listicles');
}
export function loadReviews() {
  return readJsonDir('reviews');
}
export function loadGear() {
  return readJsonDir('gear');
}
export function loadArticles() {
  return readJsonDir('articles');
}
export function loadTravelAgencies() {
  return readJsonDir('travel-agencies');
}

/**
 * Builds { name, reviewSlug } pairs for every race that has a live review
 * page -- one entry for the entity's full name, plus a couple of common
 * variants (a bracketed short code like "(KLSCM)", and the name with a
 * trailing "(9th ed.)"-style edition annotation or bracket stripped) --
 * since prose mentioning a race by name doesn't always match the stored
 * entity.name character-for-character.
 *
 * Consumed by gear/[slug].astro, articles/[slug].astro, and
 * reviews/[slug].astro to auto-link the first mention of a race in body
 * prose back to that race's own review, without any content author having
 * to hand-write the link. See ReviewArticle.astro's raceLinks prop.
 *
 * Deliberately returns slugs, not built urls.review()/urls.entity() calls --
 * this file stays Astro-free (see the module doc comment above), so turning a
 * slug into a path is left to the page importing it.
 */
export function buildRaceLinkTargets() {
  const entities = loadEntities().map(stripMeta).filter(isReviewableEntity);
  const entityById = new Map(entities.map((e) => [e.entity_id, e]));
  const reviews = loadReviews().map(stripMeta).filter(isPublished);

  const targets = [];
  for (const review of reviews) {
    const entity = entityById.get(review.entity_id);
    if (!entity) continue;

    const aliases = new Set([entity.name]);

    // Only treat a bracketed parenthetical as a genuine short-code alias
    // (e.g. "(KLSCM)", "(SOHM)") when it's written in caps the way real
    // abbreviations are -- a name like "Sagisag Half Marathon (Manila)" or
    // "Takbo Para sa Kalikasan (Air)" uses the same parens for a city/venue
    // qualifier, and linking every mention of the word "Manila" or "Air"
    // across the site to one specific race would be a false-positive trap.
    const bracketMatch = entity.name.match(/\(([A-Z0-9]{2,12})\)/);
    if (bracketMatch) aliases.add(bracketMatch[1]);

    const withoutEdition = entity.name
      .replace(/\s*\(\d+(?:st|nd|rd|th)\s+ed\.?\)\s*/i, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (withoutEdition && withoutEdition !== entity.name) aliases.add(withoutEdition);

    const withoutBracket = entity.name.replace(/\s*\([^)]*\)\s*$/, '').trim();
    if (withoutBracket && withoutBracket !== entity.name) aliases.add(withoutBracket);

    // Entity pages are built for isPublished entities only, while this pool
    // uses the wider isReviewableEntity gate -- so an archived race has a
    // review page but NO entity page. entityHasPage lets a merged build point
    // autolinks at the entity page where one exists and fall back to the
    // review URL where it doesn't, instead of linking to a 404.
    const entityHasPage = isPublished(entity);

    for (const name of aliases) {
      if (name.length < 3) continue; // guards against a stray short bracket match becoming a link target
      // Both slugs, because the link target depends on enabledFeatures.mergedReviews:
      // merged builds link race mentions to the entity page (which now carries the
      // review body), unmerged builds link to the standalone review.
      targets.push({ name, reviewSlug: review.slug, entitySlug: entity.slug, entityHasPage });
    }
  }
  return targets;
}

/** Strips the __file debug field before handing data to a schema or a page. */
export function stripMeta(item) {
  const { __file, ...rest } = item;
  return rest;
}

/**
 * Should this record appear on the public site?
 *
 * The four statuses (schema/base.js) split into two very different groups:
 *
 *   - "draft" and "archived" are editorial decisions -- not ready yet, or
 *     deliberately retired. Those stay off the site.
 *   - "active" and "needs_review" are both *published*. "needs_review" only
 *     means the refresh pipeline noticed something worth a human glance
 *     (a fact changed, a source didn't respond); it is a note to the
 *     operator, not a verdict on the listing.
 *
 * Treating "needs_review" as unpublished is a trap: refresh-entities.js
 * flags a record for review on any core-fact change, so a routine refresh
 * can silently delete a large slice of the directory from the live site --
 * exactly the failure mode that made a full listing collapse to a partial
 * one here. Publishing decisions belong in one place, so every page and the
 * sitemap call this instead of comparing status inline.
 */
const PUBLISHED_STATUSES = new Set(['active', 'needs_review']);

export function isPublished(item) {
  return PUBLISHED_STATUSES.has(item?.status);
}

/**
 * Should a review of this entity stay linkable, even after the entity
 * itself is archived?
 *
 * refresh-entities.js archives an entity the instant its race date passes
 * (see its "lapsed" branch) -- that's the right call for hub/category/
 * region listings, which exist to help someone find a race to enter, not
 * one that already happened. But a *review* is evergreen editorial content:
 * once written, it stays a legitimate answer to "what was this race like"
 * long after race day, and reviews/[slug].astro already renders a "this
 * edition has already taken place" banner (via isLapsed) for exactly this
 * case. Excluding it here would silently 404 every review the day after
 * its race, no matter how good the writing is.
 *
 * "draft" is the one status that means genuinely not ready -- that stays
 * excluded, same as isPublished.
 */
export function isReviewableEntity(entity) {
  return entity?.status !== 'draft';
}

/**
 * region_id -> how many published entities that region covers, counting
 * every descendant region (so "Thailand" includes "Nong Khai").
 *
 * Every region in `regions` gets an entry, including the zeroes -- callers
 * need to be able to ask "is this one empty?" and get an answer rather than
 * an undefined.
 */
export function buildRegionEntityCounts(regions, entities) {
  const ancestry = buildRegionAncestryMap(regions);
  const counts = new Map(regions.map((r) => [r.region_id, 0]));
  for (const entity of entities) {
    for (const id of ancestry.get(entity.region_id) ?? [entity.region_id]) {
      if (counts.has(id)) counts.set(id, counts.get(id) + 1);
    }
  }
  return counts;
}

/**
 * Should this region appear in a hub grid, a count, or the sitemap?
 *
 * A region with nothing to list is not a smaller version of a covered
 * region -- it is a page that answers its own question with "nothing".
 * Timor-Leste is the case that made this necessary: its single race (the
 * Dili International Marathon, 8 Aug 2026) lapsed and was archived, leaving
 * a hub card still promising a calendar "headlined by the Dili
 * International Marathon", a "0" on the count beside it, and the country
 * still counted in the homepage's "11 Countries". Every one of those three
 * claims came from a different line of code reading `regions` directly, so
 * the rule lives here instead and every caller asks the same question.
 *
 * The region's own page is still BUILT (see regions/[slug].astro) -- a URL
 * that has been live and crawled is better served by an honest empty state
 * than by a new 404 -- but it is dropped from the sitemap and from every
 * internal grid, so nothing points at it while it has nothing to say.
 */
export function regionHasEntities(region, counts) {
  return (counts.get(region?.region_id) ?? 0) > 0;
}

/**
 * Builds a region_id -> [region_id, ...all ancestor region_ids] map, so a
 * "Thailand" (country) listicle/hub filter can match races whose region_id
 * is the more specific "Nong Khai" (city, parent_region_id: "thailand")
 * without any vertical-specific geography logic.
 */
export function buildRegionAncestryMap(regions) {
  const byId = new Map(regions.map((r) => [r.region_id, r]));
  const map = new Map();
  for (const region of regions) {
    const chain = [region.region_id];
    let current = region;
    while (current.parent_region_id) {
      chain.push(current.parent_region_id);
      current = byId.get(current.parent_region_id);
      if (!current) break; // dangling parent_region_id -- validate-data.js should flag this
    }
    map.set(region.region_id, chain);
  }
  return map;
}
