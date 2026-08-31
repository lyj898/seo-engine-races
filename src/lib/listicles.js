import { buildRegionAncestryMap, isPublished } from './data.js';
import { isLapsed } from './succession.js';
import { entityMatchesCategory } from './categoryMatch.js';

/**
 * Resolves a listicle's `filters` + `manual_entity_ids` into an actual
 * ordered entity list at build time. This is the "generated from
 * structured filters + editorial config, not written manually from
 * scratch" requirement -- editors add a filter (and optionally pin/exclude
 * specific entities); they never hand-maintain the list itself.
 */
export function resolveListicleEntities(listicle, entities, regions, categories = []) {
  const ancestryMap = buildRegionAncestryMap(regions);
  const filters = listicle.filters ?? {};
  const manualIds = listicle.manual_entity_ids ?? [];

  let results = entities.filter((entity) => {
    if (filters.region_id) {
      const chain = ancestryMap.get(entity.region_id) ?? [entity.region_id];
      if (!chain.includes(filters.region_id)) return false;
    }
    if (filters.category_id) {
      // Same membership rule as the category hub pages: an entity counts if
      // the category is its marquee one OR one of its numeric facts falls in
      // that category's range. Otherwise a "Best 5K" guide would be empty
      // while the 5K hub listed 144 entries.
      const target = categories.find((c) => c.category_id === filters.category_id);
      if (target ? !entityMatchesCategory(entity, target, categories) : entity.category_id !== filters.category_id) return false;
    }
    if (filters.tags_any?.length) {
      const hasTag = filters.tags_any.some((tag) => entity.tags?.includes(tag));
      if (!hasTag) return false;
    }
    if (filters.core_facts_filters?.length) {
      const allMatch = filters.core_facts_filters.every((cond) => matchesCoreFactsFilter(entity.core_facts, cond));
      if (!allMatch) return false;
    }
    // Lapsed as well as unpublished. A guide is a recommendation -- "the best
    // full marathons in Malaysia" is advice about what to enter -- so an
    // edition that has already been run is not a weaker entry in it, it is a
    // wrong one. Dropping them here rather than at each call site also means
    // the fingerprint below reflects the set actually shown, so a guide whose
    // races have since run is correctly reported as having stale copy.
    return isPublished(entity) && !isLapsed(entity);
  });

  // Editorial pins: include manually-listed entities even if they don't
  // match the filters, without duplicating an entity that matched both ways.
  const resultIds = new Set(results.map((e) => e.entity_id));
  for (const id of manualIds) {
    if (resultIds.has(id)) continue;
    const pinned = entities.find((e) => e.entity_id === id);
    // A pin overrides the filters, not the calendar. Editorial intent is
    // "this one belongs in the guide", which stops being true the day the
    // race is run -- and a pin is exactly how a finished race would persist
    // at the top of a guide long after the filters stopped returning it.
    if (pinned && !isLapsed(pinned)) {
      results.push(pinned);
      resultIds.add(id);
    }
  }

  if (filters.sort_by) {
    const dir = filters.sort_direction === 'asc' ? 1 : -1;
    results = [...results].sort((a, b) => {
      const av = getSortValue(a, filters.sort_by);
      const bv = getSortValue(b, filters.sort_by);
      if (av === bv) return 0;
      return av > bv ? dir : -dir;
    });
  }

  if (filters.limit) {
    results = results.slice(0, filters.limit);
  }

  return results;
}

function getCoreFactValue(coreFacts, field) {
  return field.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), coreFacts);
}

function getSortValue(entity, sortBy) {
  if (sortBy in entity) return entity[sortBy];
  return getCoreFactValue(entity.core_facts, sortBy);
}

function matchesCoreFactsFilter(coreFacts, cond) {
  const value = getCoreFactValue(coreFacts, cond.field);
  switch (cond.op) {
    case 'eq':
      return value === cond.value;
    case 'neq':
      return value !== cond.value;
    case 'gt':
      return value > cond.value;
    case 'gte':
      return value >= cond.value;
    case 'lt':
      return value < cond.value;
    case 'lte':
      return value <= cond.value;
    case 'in':
      return Array.isArray(cond.value) && cond.value.includes(value);
    case 'contains':
      return Array.isArray(value) ? value.includes(cond.value) : String(value ?? '').includes(cond.value);
    default:
      return true;
  }
}

/**
 * A short, stable fingerprint of the entity set a guide resolved to.
 *
 * WHY A GUIDE NEEDS ONE
 * resolveListicleEntities() above re-runs every build, so the LIST in a
 * guide is always current. Its prose is not: the intro, the FAQs and the
 * "Our pick" blurb are written once, at generation time, against whatever
 * the calendar looked like that day -- and then never looked at again. The
 * results were guides confidently describing a directory that no longer
 * exists: the Philippines 10K guide opened with "Every 10K on this list
 * falls in a single two-week window, August 15 to 30, 2026" days before
 * that window closed, and the Malaysia marathon guide led with Bintulu and
 * Alor Setar, two races that had since been run and archived.
 *
 * Storing the fingerprint alongside the copy makes that detectable rather
 * than invisible: if the set the copy was written about no longer matches
 * the set on the page, the copy is stale, and both the renderer (which
 * falls back to a description derived from live data) and
 * generate-listicles.js --refresh-stale (which rewrites it) can act on it.
 *
 * Entity ids, sorted, so pure reordering -- a re-rank after one review
 * lands -- does not by itself count as a change. Membership does.
 *
 * FNV-1a rather than node:crypto so this file stays importable from an
 * Astro page and a plain script alike, with no import that only resolves in
 * one of the two.
 */
export function listicleFingerprint(entities = []) {
  const ids = entities
    .map((e) => e?.entity_id ?? e?.slug ?? '')
    .filter(Boolean)
    .sort()
    .join('|');
  let hash = 0x811c9dc5;
  for (let i = 0; i < ids.length; i++) {
    hash ^= ids.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  // Length is part of the fingerprint too: two different sets colliding on
  // the 32-bit hash would still have to share a size to pass as unchanged.
  return `${entities.length}-${hash.toString(16).padStart(8, '0')}`;
}

/**
 * Is a guide's stored copy still describing the set on the page?
 *
 * A guide with no stored fingerprint at all counts as stale -- it was
 * written before this check existed, which is exactly the population the
 * check was added for.
 */
export function isListicleCopyStale(listicle, resolvedEntities) {
  const stored = listicle?.source_fingerprint;
  if (typeof stored !== 'string' || !stored) return true;
  return stored !== listicleFingerprint(resolvedEntities);
}
