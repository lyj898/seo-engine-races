/**
 * Shared ordering for entity lists.
 *
 * Hub pages previously did no sorting at all, so entities came out in
 * filesystem order -- effectively alphabetical by slug. On a directory whose
 * whole purpose is "what's coming up", an A-Z list is close to useless and
 * it contradicted the home page, which is strictly chronological. Anyone
 * moving between the two saw the same records in two unrelated orders.
 *
 * Soonest-first, with two deliberate refinements:
 *   - Entities whose date has already passed sort to the very end rather
 *     than the front. Source pages occasionally carry a mis-parsed year, and
 *     one bad record shouldn't be the first thing on a hub page.
 *   - Entities with no date at all sort last too, then alphabetically, so a
 *     vertical without dates still gets a stable, sensible order instead of
 *     an arbitrary one.
 */
const todayIso = () => new Date().toISOString().slice(0, 10);

export function byUpcomingDate(a, b, today = todayIso()) {
  const da = a?.core_facts?.date;
  const db = b?.core_facts?.date;

  const rank = (d) => (typeof d !== 'string' ? 2 : d < today ? 1 : 0);
  const ra = rank(da);
  const rb = rank(db);
  if (ra !== rb) return ra - rb;

  if (ra === 2) return String(a?.name ?? '').localeCompare(String(b?.name ?? ''));
  // Within upcoming: earliest first. Within past: most recent first, so the
  // tail reads as "just happened" rather than "ancient history".
  if (da === db) return String(a?.name ?? '').localeCompare(String(b?.name ?? ''));
  return ra === 1 ? (da < db ? 1 : -1) : da < db ? -1 : 1;
}
