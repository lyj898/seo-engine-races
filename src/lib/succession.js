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

// ---- same-race matching, shared by the predecessor search and the successor
// fallback. Slug years are unreliable in this data (miri-marathon-2027 holds a
// 2026 date), so these compare slug STEMS and NAMES, never the slug's year.
const hasIsoDate = (e) => typeof e?.core_facts?.date === 'string' && e.core_facts.date.length >= 10;
const slugStem = (e) => getSeriesKey(e).replace(/-(\d+(st|nd|rd|th)-ed|\d+(st|nd|rd|th))$/, '');
const nameStem = (e) =>
  String(e?.name ?? '')
    .toLowerCase()
    .replace(/\b(powered|presented)\s+by\b.*$/, '')
    .replace(/\b(19|20)\d\d\b/g, '')
    .replace(/\b\d+(st|nd|rd|th)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
// 8+ characters so a generic name like "Run" cannot match everything.
const sameRace = (a, b) =>
  slugStem(a) === slugStem(b) || (nameStem(a).length >= 8 && nameStem(a) === nameStem(b));

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
  if (year != null) {
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

    if (later.length) return later[0].e;
  }

  // Fallback, only reached when the slug-year logic above finds nothing --
  // so every forward link it already produced is unchanged by construction.
  // It exists for records whose slug year is wrong or missing. The 2026 Borneo
  // International Marathon is slugged ...-2027, so neither bumping its year
  // nor its series key could ever reach borneo-international-marathon-2027;
  // angkor-empire-marathon has no slug year at all.
  // Measured on 2026-09-28 over all 121 lapsed race pages: this adds a
  // correct forward link to 5 and changes or removes none.
  if (!hasIsoDate(entity)) return null;
  const byDate = entities
    .filter((e) => e.entity_id !== entity.entity_id && hasIsoDate(e) &&
      e.core_facts.date > entity.core_facts.date && sameRace(e, entity))
    .sort((a, b) => a.core_facts.date.localeCompare(b.core_facts.date));
  return byDate.length ? byDate[0] : null;
}

/**
 * Find the most recent EARLIER edition of `entity` that has already been run
 * -- the mirror of findSuccessorEntity, used to decide whether a race has a
 * past edition worth reviewing (a review is about an edition that happened;
 * see scripts/lib/review-selection.js).
 *
 * Deliberately NOT built on the slug's trailing year the way
 * findSuccessorEntity is. Slug years are unreliable in this data: records such
 * as miri-marathon-2027 and scenic-half-marathon-chanthaburi-2027 hold 2026
 * dates. So editions are ordered by their real core_facts.date, and two
 * records count as the same race when EITHER
 *   - their slugs share a series key once the year and any edition ordinal
 *     ("-5th-ed", "-11th") are stripped, or
 *   - their names match once years, ordinals, "powered by"/"presented by"
 *     tails and punctuation are stripped (8+ characters, so a generic name
 *     like "Run" cannot match everything).
 * Checked on 2026-09-28 against every record: six predecessor pairs, both
 * name-only matches genuinely the same race, and "Kota Kinabalu Marathon"
 * correctly NOT paired with the separate Kota Kinabalu Half Marathon.
 *
 * Conservative by design, and it misses some: a predecessor the data does not
 * hold, or one whose name was recorded differently, is not found. That is the
 * safe direction for its only caller -- a race skipped here is reviewed later,
 * once its own edition has been run -- whereas a wrong match would send a
 * review off to describe some other event's history.
 *
 * @param {object}   entity
 * @param {object[]} entities  every record to search (archived ones included:
 *                              predecessors are almost always archived)
 * @param {string}   [today]   ISO date; defaults to now
 * @returns {object|null}
 */
export function findPredecessorEntity(entity, entities, today) {
  const t = today ?? new Date().toISOString().slice(0, 10);
  if (!hasIsoDate(entity)) return null;

  const earlier = entities
    .filter(
      (e) =>
        e.entity_id !== entity.entity_id &&
        hasIsoDate(e) &&
        isLapsed(e, t) &&
        e.core_facts.date < entity.core_facts.date &&
        sameRace(e, entity)
    )
    .sort((a, b) => b.core_facts.date.localeCompare(a.core_facts.date));

  return earlier.length ? earlier[0] : null;
}
