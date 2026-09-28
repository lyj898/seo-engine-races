import { isLapsed, findPredecessorEntity } from '../../src/lib/succession.js';

/**
 * Review candidate selection: which races may be reviewed, and in what order.
 *
 * The rule (set 2026-09-28): a review is about an edition that has been run,
 * never a preview of one that has not. Two consequences, applied here:
 *
 *   - ELIGIBILITY. A race may be reviewed only if it has a past edition to
 *     write about. A completed edition always qualifies -- it IS the past
 *     edition. An upcoming race qualifies only if an earlier, already-run
 *     edition of the same race exists (findPredecessorEntity). Anything else is
 *     skipped, including undated records, which can be placed on neither side
 *     of today. Skipping is not permanent: once a skipped race's own edition
 *     runs, it becomes a completed edition and qualifies on its own.
 *
 *   - ORDER. Completed editions first, most recently run first; then eligible
 *     upcoming races, soonest first.
 *
 * Lives in its own module because generate-reviews.js calls run() at import
 * time, so importing it to test this logic would start a real generation pass.
 */

const hasDate = (e) => typeof e?.core_facts?.date === 'string' && e.core_facts.date.length >= 10;

/**
 * Why a race does or does not have a past edition to review.
 * @returns {{ eligible: boolean, reason: string, predecessor?: object }}
 */
export function pastEditionStatus(entity, allEntities, today) {
  const t = today ?? new Date().toISOString().slice(0, 10);
  if (!hasDate(entity)) return { eligible: false, reason: 'no usable date' };
  if (isLapsed(entity, t)) return { eligible: true, reason: 'this edition has been run' };
  const predecessor = findPredecessorEntity(entity, allEntities, t);
  if (predecessor) {
    return { eligible: true, reason: `previous edition ${predecessor.slug} (${predecessor.core_facts.date})`, predecessor };
  }
  return { eligible: false, reason: 'upcoming, and no earlier edition in the data' };
}

/**
 * Order candidates: completed editions first (most recently run first), then
 * upcoming (soonest first), then undated. Pure ordering -- no filtering.
 * Kept as its own export because the order is useful independent of the
 * eligibility rule.
 */
export function orderPastEditionsFirst(pool, today) {
  const t = today ?? new Date().toISOString().slice(0, 10);
  const past = pool
    .filter((e) => isLapsed(e, t))
    .sort((a, b) => b.core_facts.date.localeCompare(a.core_facts.date));
  const upcoming = pool
    .filter((e) => hasDate(e) && !isLapsed(e, t))
    .sort((a, b) => a.core_facts.date.localeCompare(b.core_facts.date));
  const undated = pool.filter((e) => !hasDate(e));
  return [...past, ...upcoming, ...undated];
}

/**
 * Filter to races with a past edition, then order them.
 *
 * @param {object}   args
 * @param {object[]} args.pool         candidates (entities missing a review, etc.)
 * @param {object[]} args.allEntities  every record, archived included -- where
 *                                     predecessors are looked up
 * @param {string}   [args.today]
 * @returns {{ queue: object[], skipped: {entity: object, reason: string}[] }}
 */
export function selectReviewCandidates({ pool, allEntities, today }) {
  const t = today ?? new Date().toISOString().slice(0, 10);
  const eligible = [];
  const skipped = [];
  for (const entity of pool) {
    const status = pastEditionStatus(entity, allEntities, t);
    if (status.eligible) eligible.push(entity);
    else skipped.push({ entity, reason: status.reason });
  }
  return { queue: orderPastEditionsFirst(eligible, t), skipped };
}
