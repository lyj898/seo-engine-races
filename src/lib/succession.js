/**
 * Year-over-year succession helpers.
 *
 * Recurring events are stored as one entity per edition, slugged with a
 * trailing year -- "taiping-half-marathon-2026". When an edition's date has
 * passed, a reader landing on it (or on its review) is better served by a
 * pointer to the next edition than by a dead end. These helpers find that
 * successor from the data we already have, with no per-entity hand-linking.
 *
 * They are deliberately conservative: they only ever return an entity that
 * genuinely exists and is published, and return null when they can't be sure
 * -- a wrong "next year" link is worse than none.
 */

/** Trailing 4-digit year in a slug, or null. */
export function getEntityYear(entity) {
  const m = String(entity?.slug ?? '').match(/(\d{4})$/);
  return m ? Number(m[1]) : null;
}

/** The slug with its trailing "-YYYY" removed, used to group editions. */
export function getSeriesKey(entity) {
  return String(entity?.slug ?? '').replace(/-?\d{4}$/, '');
}

/** True when the entity has a date and that date is strictly in the past. */
export function isLapsed(entity, today) {
  const t = today ?? new Date().toISOString().slice(0, 10);
  const d = entity?.core_facts?.date;
  return typeof d === 'string' && d.length >= 10 && d < t;
}

/**
 * Find the nearest later edition of `entity` among `entities`.
 *
 * Primary strategy: bump the trailing year (+1..+3) and look for an entity
 * with that exact slug -- the reliable case, since editions keep the same
 * base slug. Fallback: scan for any published entity sharing the series key
 * with a greater year, and take the earliest. Returns null if none found.
 */
export function findSuccessorEntity(entity, entities) {
  const year = getEntityYear(entity);
  if (year == null) return null;

  const bySlug = new Map(entities.map((e) => [e.slug, e]));
  for (let dy = 1; dy <= 3; dy++) {
    const candidateSlug = entity.slug.replace(/(\d{4})$/, String(year + dy));
    if (candidateSlug !== entity.slug && bySlug.has(candidateSlug)) {
      return bySlug.get(candidateSlug);
    }
  }

  const base = getSeriesKey(entity);
  const later = entities
    .filter((e) => e.entity_id !== entity.entity_id && getSeriesKey(e) === base)
    .map((e) => ({ e, y: getEntityYear(e) }))
    .filter((x) => x.y != null && x.y > year)
    .sort((a, b) => a.y - b.y);

  return later.length ? later[0].e : null;
}
