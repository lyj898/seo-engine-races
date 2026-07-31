import { buildRegionAncestryMap, isPublished } from './data.js';
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
    return isPublished(entity);
  });

  // Editorial pins: include manually-listed entities even if they don't
  // match the filters, without duplicating an entity that matched both ways.
  const resultIds = new Set(results.map((e) => e.entity_id));
  for (const id of manualIds) {
    if (resultIds.has(id)) continue;
    const pinned = entities.find((e) => e.entity_id === id);
    if (pinned) {
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
