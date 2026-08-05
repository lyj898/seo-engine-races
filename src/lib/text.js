/**
 * Splits a string containing exactly one `*accent word*` marker into
 * { before, accent, after }, so the home page hero can render one word
 * with a distinct visual treatment (outlined text, matching runsea.run's
 * reference design) without hardcoding which word that is -- it's whatever
 * site.config.json.heroHeadline marks with asterisks.
 *
 * Falls back to { before: text, accent: '', after: '' } if no marker is
 * found, so a vertical instance that skips this optional config field
 * still renders a plain headline instead of breaking.
 */
export function splitAccentWord(text) {
  const match = /^(.*?)\*(.+?)\*(.*)$/.exec(text ?? '');
  if (!match) return { before: text ?? '', accent: '', after: '' };
  const [, before, accent, after] = match;
  return { before, accent, after };
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Splits an ISO "YYYY-MM-DD" date string into a { day, month } pair for a
 * calendar-style date badge (e.g. "1" / "AUG"). Generic to any
 * date-carrying vertical's core_facts, not races-specific -- events,
 * courses, anything with a date field can use this. Returns null if the
 * string isn't a parseable ISO date, so a caller can fall back gracefully.
 */
export function formatDayMonth(isoDate) {
  if (typeof isoDate !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!match) return null;
  const [, , monthNum, dayNum] = match;
  const monthIndex = Number(monthNum) - 1;
  if (monthIndex < 0 || monthIndex > 11) return null;
  return { day: String(Number(dayNum)), month: MONTH_NAMES[monthIndex].slice(0, 3).toUpperCase() };
}

/** "2026-08-01" -> "August 2026". Used to group entities by month. Returns null if unparseable. */
export function formatMonthLabel(isoDate) {
  if (typeof isoDate !== 'string') return null;
  const match = /^(\d{4})-(\d{2})/.exec(isoDate);
  if (!match) return null;
  const [, year, monthNum] = match;
  const monthIndex = Number(monthNum) - 1;
  if (monthIndex < 0 || monthIndex > 11) return null;
  return `${MONTH_NAMES[monthIndex]} ${year}`;
}

/** "2026-08" sort/filter key for a date string, or null if unparseable. */
export function monthKey(isoDate) {
  if (typeof isoDate !== 'string') return null;
  const match = /^(\d{4}-\d{2})/.exec(isoDate);
  return match ? match[1] : null;
}

/**
 * Free-text status fields in seed data show up two ways: a snake_case
 * placeholder (e.g. "not_yet_announced") or an already-human sentence (e.g.
 * "Open (via Google Form/Facebook)"). This humanizes only the former,
 * leaving anything with a space alone -- so a full free-text status isn't
 * mangled by a title-casing pass meant only for the placeholder format.
 */
export function humanizeStatus(status) {
  if (typeof status !== 'string' || !status.trim()) return '';
  if (status.includes(' ')) return status;
  return status
    .split('_')
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Is a free-text status value actually a "we don't know" placeholder rather
 * than real information? Seed/migration passes commonly fill an unknown
 * status field with a stand-in like "not_yet_announced", "TBA" or "unknown"
 * instead of leaving it empty -- rendering those verbatim tells a visitor
 * nothing and actively misleads (an event happening this weekend showing
 * "Not Yet Announced" reads as a data error, because it is one).
 *
 * Deliberately anchored (^...$) so it only catches a status that is *only*
 * the placeholder: a genuinely informative status that happens to contain
 * one of these phrases -- "Not yet confirmed open", "Opens 8 Jul 2026" --
 * is real information and still displays.
 */
const UNKNOWN_STATUS_RE = /^(not[\s_-]*yet[\s_-]*announced|to[\s_-]*be[\s_-]*announced|tba|tbc|tbd|unknown|unconfirmed|none|n\/?a)$/i;

export function isUnknownStatus(status) {
  if (typeof status !== 'string') return true;
  return !status.trim() || UNKNOWN_STATUS_RE.test(status.trim());
}

/**
 * Heuristic: does a free-text registration_status string suggest
 * registration is currently open? Used only by the optional "open for
 * registration" filter -- a false negative just leaves a race out of a
 * narrowed filter view, never hides it from the full unfiltered listing.
 */
export function isLikelyRegistrationOpen(status) {
  if (typeof status !== 'string') return false;
  const s = status.toLowerCase();
  // Exclusions first: "not yet open"/"opening soon"/"opens <date>" all
  // contain the substring "open" but mean the opposite of open, so this
  // checks for "open" as its own whole word (\bopen\b -- excludes "opens",
  // "opening") only after ruling out the not-yet-open phrasings.
  if (/not yet|not_yet|tba|to be announced|closed|pending/.test(s)) return false;
  return /\bopen\b/.test(s);
}

/**
 * Collapses a free-text availability status to one of three states:
 * 'open', 'closed', or null (meaning "we don't know -- say nothing").
 *
 * Source pages write this field in dozens of shapes: "Open (Early Bird)",
 * "Pendaftaran Dibuka (Registration Open)", "Sold Out", "Opens 8 Jul 2026",
 * "Not yet confirmed open (2027)". Printing those verbatim turns a listing
 * card into a wall of inconsistent micro-copy, and the date-bearing ones go
 * stale the moment the date passes -- a card still promising "Opens 6 May
 * 2026" in August is worse than saying nothing at all.
 *
 * So only the two states a visitor can act on survive. A promised future
 * opening date is deliberately *not* one of them: it's a claim that decays,
 * and we can't re-verify it between refreshes. Returning null lets the
 * caller omit the line entirely rather than print a non-answer.
 */
export function simplifyAvailabilityStatus(status) {
  if (typeof status !== 'string' || isUnknownStatus(status)) return null;
  const s = status.toLowerCase();
  // Closed wins over open: "Closed (pending rescheduled date)" and "Sold Out"
  // both describe a door that is shut, however they phrase it.
  if (/closed|sold out|fully booked|ended|full house/.test(s)) return 'closed';
  return isLikelyRegistrationOpen(status) ? 'open' : null;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isIsoDate = (v) => typeof v === 'string' && ISO_DATE_RE.test(v);

/**
 * Registration state for a race, with the passage of time taken into account.
 *
 * simplifyAvailabilityStatus() above reads only the free-text status string,
 * and that string is a snapshot with no expiry. An entity stamped "open" in
 * June still reports "open" in August, however long ago entries actually
 * shut -- which is precisely how the live site spent five weeks inviting
 * readers to enter the Sarawak Energy Marathon after its 30 June deadline.
 * The refresh pipeline can't be relied on to catch it either: it re-verifies
 * 25 entities a week against a directory of 200+.
 *
 * So the two dates we can check independently override the string:
 *
 *   registration_deadline in the past -> closed, whatever the status says
 *   race date in the past             -> closed (you cannot enter a race
 *                                        that has already been run)
 *
 * A missing deadline is not evidence of anything, so where there is none the
 * status string still decides -- but a stale "open" is now bounded by race
 * day instead of persisting indefinitely.
 *
 * ISO date strings compare correctly with `<`, so no Date parsing is needed
 * and no timezone can shift the answer by a day.
 *
 * @param {object} facts  an entity's core_facts
 * @param {string} [today] ISO date; injectable so tests aren't clock-dependent
 * @returns {'open'|'closed'|null} null means "we don't know -- say nothing"
 */
export function resolveRegistrationState(facts, today = new Date().toISOString().slice(0, 10)) {
  if (!facts || typeof facts !== 'object') return null;
  if (isIsoDate(facts.registration_deadline) && facts.registration_deadline < today) return 'closed';
  if (isIsoDate(facts.date) && facts.date < today) return 'closed';
  return simplifyAvailabilityStatus(facts.registration_status);
}

/**
 * core_facts with registration_status reconciled against the clock, for
 * generic renderers that print the raw string.
 *
 * FactsTable knows nothing about any vertical's field names -- it prints
 * every core fact it is handed. That is the right design, but it means the
 * entity detail page renders registration_status verbatim and so bypasses
 * every expiry rule the cards apply. The result was two different answers
 * for the same race on the same site: a card correctly saying nothing, and
 * a detail table still announcing "Opens 8 Jul 2026" in August.
 *
 * isUnknownStatus() doesn't catch those, and deliberately so -- it draws the
 * line at placeholder-vs-information, which is a different question from
 * whether the information has expired. This draws the second line:
 *
 *   closed -> "Closed", replacing whatever phrasing the source used
 *   open   -> the original string, so useful nuance ("Open (Early Bird)",
 *             "Open (Public: 3 Jul - 31 Oct 2026)") survives
 *   null   -> drop the field, so the row disappears instead of printing a
 *             claim we can no longer stand behind
 */
export function withResolvedRegistration(facts, today = new Date().toISOString().slice(0, 10)) {
  if (!facts || typeof facts !== 'object') return facts;
  const state = resolveRegistrationState(facts, today);
  if (state === null) {
    const { registration_status, ...rest } = facts;
    return rest;
  }
  return state === 'closed' ? { ...facts, registration_status: 'Closed' } : facts;
}
