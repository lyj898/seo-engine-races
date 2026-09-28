import { isLapsed } from '../../src/lib/succession.js';

/**
 * Order review candidates so completed editions are written first.
 *
 * A review is about an edition that has been run, not a preview of one that
 * has not (set 2026-09-28). The order that follows from that rule:
 *
 *   1. Editions already run, MOST RECENTLY RUN first. That is when race
 *      reports, results and runners' own accounts are freshest and easiest to
 *      find, and when search demand for "<race> results" and "<race> photos"
 *      peaks -- both observed in Search Console for this site.
 *   2. Upcoming editions, soonest first. Only reached once the backlog of
 *      completed ones is empty.
 *   3. Anything without a usable date, last. A record with a date of "tbc"
 *      cannot be placed on either side of today.
 *
 * "Already run" is isLapsed from src/lib/succession.js -- the same predicate
 * every listing surface and archive-lapsed.js use -- so the pipeline cannot
 * disagree with the site about which editions are in the past.
 *
 * This lives in its own module rather than inside generate-reviews.js because
 * that script calls run() at import time. Importing it to test the ordering
 * would start a real generation pass.
 *
 * @param {object[]} pool   entities (stripMeta'd) eligible for a review
 * @param {string}   [today] ISO date, e.g. "2026-09-28"; defaults to now
 * @returns {object[]} a new array; `pool` is not mutated
 */
export function orderPastEditionsFirst(pool, today) {
  const t = today ?? new Date().toISOString().slice(0, 10);
  const hasDate = (e) => typeof e?.core_facts?.date === 'string' && e.core_facts.date.length >= 10;

  const past = pool
    .filter((e) => isLapsed(e, t))
    .sort((a, b) => b.core_facts.date.localeCompare(a.core_facts.date));
  const upcoming = pool
    .filter((e) => hasDate(e) && !isLapsed(e, t))
    .sort((a, b) => a.core_facts.date.localeCompare(b.core_facts.date));
  const undated = pool.filter((e) => !hasDate(e));

  return [...past, ...upcoming, ...undated];
}
