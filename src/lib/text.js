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
 * registration is currently open? Nothing on the site renders this -- it
 * feeds scripts/validate-data.js, which uses it to flag a stored status
 * that contradicts the entity's own dates, so a false negative costs a
 * warning rather than misleading a reader.
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
 * Phrasings that mean "you cannot enter yet, but this is not closed" --
 * registration that hasn't been announced, hasn't opened, or is described
 * as opening on some future date.
 *
 * Matched against the status with underscores and hyphens flattened to
 * spaces (see deSnake below), so a snake_case placeholder and the same
 * thing written as a sentence land on the same rule. Flattening first is
 * what makes \b usable here: in "ballot_opening_soon" the underscore is a
 * word character, so \bopening never matches until it becomes a space.
 */
const NOT_YET_OPEN_RE =
  /not yet (open|announced|confirmed|available|live)|\bopening soon\b|\bcoming soon\b|\bopens\b|\bwill open\b/i;

const deSnake = (text) => String(text).replace(/[_-]+/g, ' ');

const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec';
// "1 Jul 2026", "8 July 2026", "May 5, 2026" -- the two shapes source pages
// actually use for a promised opening date.
const DATE_IN_TEXT_RE = new RegExp(
  `\\b(?:(\\d{1,2})\\s+(${MONTHS})[a-z]*\\s+(\\d{4})|(${MONTHS})[a-z]*\\s+(\\d{1,2}),?\\s+(\\d{4}))\\b`,
  'gi'
);
const MONTH_INDEX = Object.fromEntries(MONTHS.split('|').map((m, i) => [m, i + 1]));

/**
 * Every calendar date named inside a free-text status, as ISO strings.
 * Used to age out a promise: "Opens 8 Jul 2026" stops being an answer on
 * 9 July, and there is no other field that knows that.
 */
function datesNamedIn(text) {
  const out = [];
  for (const m of String(text).matchAll(DATE_IN_TEXT_RE)) {
    const [, dayFirst, monthA, yearA, monthB, dayB, yearB] = m;
    const day = Number(dayFirst ?? dayB);
    const month = MONTH_INDEX[(monthA ?? monthB).toLowerCase()];
    const year = Number(yearA ?? yearB);
    if (!day || !month || !year) continue;
    out.push(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  }
  return out;
}

/**
 * Collapses a free-text availability status to one of four states: 'open',
 * 'closed', 'not_yet_open', or null (meaning "we don't know").
 *
 * This is a DATA-QUALITY tool, not a rendering one: the site publishes no
 * registration status anywhere (see withoutRegistrationClaims below), and
 * this exists so scripts/validate-data.js can normalise the dozens of
 * shapes sources write the field in -- "Open (Early Bird)", "Pendaftaran
 * Dibuka (Registration Open)", "Sold Out", "Opens 8 Jul 2026", "Not yet
 * confirmed open (2027)" -- far enough to tell whether a stored status
 * contradicts the entity's own dates.
 *
 * A status that names an opening DATE is treated as expired once that date
 * has passed: we no longer know whether entries opened on time, and won't
 * guess on the data's behalf.
 */
export function simplifyAvailabilityStatus(status, today = new Date().toISOString().slice(0, 10)) {
  if (typeof status !== 'string' || !status.trim()) return null;
  const s = status.toLowerCase();
  // Closed wins over open: "Closed (pending rescheduled date)" and "Sold Out"
  // both describe a door that is shut, however they phrase it.
  if (/closed|sold out|fully booked|ended|full house/.test(s)) return 'closed';
  if (isLikelyRegistrationOpen(status)) return 'open';
  if (NOT_YET_OPEN_RE.test(deSnake(status))) {
    return datesNamedIn(status).some((d) => d < today) ? null : 'not_yet_open';
  }
  // "TBA"/"unknown"/"n/a" and anything else unrecognised: no answer.
  return null;
}

/**
 * ---------------------------------------------------------------------------
 * Registration status is not published.
 * ---------------------------------------------------------------------------
 *
 * The stored registration_status is a snapshot with no expiry, and refresh
 * re-verifies ~25 entities a week against a directory of 200+, so it goes
 * stale faster than it can be corrected -- races running the next day were
 * still being advertised as open for entry. Ageing the string out at display
 * time bounded the damage but not the problem: the site's answer to "can I
 * still enter?" was coming from a field nobody could keep true. Saying
 * nothing beats saying something wrong, and every listing links out to the
 * official page, which is the only place that fact is ever current.
 *
 * Removing the badge alone would not have removed the claim, because the
 * generation stages wrote the same status into prose: 220 pros/cons bullets
 * ("Registration is currently open, giving runners time to plan"), 176 FAQs
 * ("Is registration open for this race?") and a closing sentence on most
 * summaries. The helpers below take those out at render time rather than
 * rewriting 237 data files, because the pipeline would just write them back
 * -- buildSummaryPrompt in scripts/lib/prompts.js is told not to produce
 * them, so the volume shrinks as entities are regenerated, and until then
 * nothing reaches a page.
 *
 * What deliberately SURVIVES:
 *   - registration_deadline: a stored date is a claim a reader can check
 *     against today for themselves; it never inverts its meaning silently.
 *   - "How do I register?" / "How much does registration cost?": process and
 *     price, not status.
 *   - anything mentioning registration without asserting whether it's open.
 */

// Who the sentence is about ("registration", "entries", "sign-ups"...).
const REGISTRATION_SUBJECT = String.raw`(?:registration|registrations|registering|entries|entry pricing|sign[- ]?ups?)`;
// ...and the assertion that makes it a status claim rather than a fact.
const REGISTRATION_STATUS_RE = /\b(open|opens|opened|opening|closed?|closes|sold out|still available|not yet|unannounced|yet to be)\b/i;

// A sentence whose SUBJECT is registration: optionally after a citation
// marker a paragraph left stranded ("[1] Registration is open"), a short
// lead-in ("As of now, registration...") and/or a couple of qualifiers
// ("Early Bird registration..."). The allowances are narrow on purpose --
// two words of slack, so "The race offers registration via..." (three) is a
// sentence about the entry process and is left alone.
const REGISTRATION_SENTENCE_RE = new RegExp(
  `^(?:\\[\\d+\\]\\s+)?(?:[^,.]{0,30},\\s+)?(?:[A-Za-z][\\w-]*\\s+){0,2}${REGISTRATION_SUBJECT}\\b`,
  'i'
);

// The same claim tacked onto the end of a sentence about something else
// ("...starts at 3:00 AM, and registration is currently open.", "...on 1
// November 2026 with open registration."). Only ever the trailing clause,
// so the part of the sentence carrying real information survives intact.
// The comma is optional but the conjunction isn't when there's no comma:
// without one of the two there's no clause boundary to cut at.
const REGISTRATION_CLAUSE_RE = new RegExp(
  `(?:[,;]\\s+|\\s+(?=(?:and|with|while|though|although|but|so|as|since|because)\\s))\\s*(?:(?:and|with|while|though|although|but|so|as|since|because)\\s+)?(?:the\\s+|open\\s+|closed\\s+)?${REGISTRATION_SUBJECT}\\b[^.!?;]*$`,
  'i'
);

/** Is this whole sentence/bullet just a registration-status claim? */
function isRegistrationStatusSentence(text) {
  const s = String(text ?? '').trim();
  return REGISTRATION_SENTENCE_RE.test(s) && REGISTRATION_STATUS_RE.test(s);
}

// A price is the one thing worth more than the removal is: "Registration is
// open with the 21.1K at PHP 1,500 and the 12K at PHP 1,200" is the only
// place that answer states its prices, and half an answer is worse than a
// stale clause in it. Dates don't count -- they're on the facts table, in
// the date badge and in the copy either side.
const PRICE_FIGURE_RE =
  /(?:usd|thb|php|idr|myr|vnd|sgd|khr|lak|mmk|bnd|rm|rp|\$|฿|₱|€|£)\s*\d|\d[\d,.]*\s*(?:usd|thb|php|idr|myr|vnd|sgd|khr|lak|mmk|bnd|rm|rp|baht|dollars?|pesos?|ringgit|rupiah|dong)\b/i;

// A sentence that points back at the one before it ("That makes it...",
// "This means prospective participants..."). Dropping what such a sentence
// refers to would leave it dangling.
const BACK_REFERENCE_RE = /^(that|this|these|those|it|they|there|which|both|either|such)\b/i;
// ...but a follow-on that is itself about signing up is just the same claim
// restated ("Registration is open. This means participants can sign up
// now."), so the pair goes together rather than the first one being spared.
const SIGN_UP_RE = /\b(registration|registrations|register|registering|sign[- ]?ups?|entries|entrants|entry)\b/i;

/**
 * Prose with registration-status claims removed: whole sentences that are
 * only that claim, plus the trailing-clause form of it
 * ("...starts at 3am, and registration is currently open.").
 *
 * Sentence splitting is on "punctuation followed by whitespace", so a
 * decimal ("42.195 km") isn't mistaken for a sentence end. Three things are
 * deliberately left in place: a sentence that also states a price, one the
 * following sentence refers back to, and -- unless the caller passes
 * allowEmpty -- text that would scrub down to nothing, since a blank summary
 * is a worse outcome than a stale sentence and every caller treats empty as
 * "no copy at all".
 */
export function scrubRegistrationClaims(text, { allowEmpty = false } = {}) {
  if (typeof text !== 'string' || !text.trim()) return text;
  const sentences = text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);

  // Marked in a first pass rather than filtered inline, because dropping a
  // status sentence can also take the follow-on sentence that only restates
  // it -- a decision that has to be made looking forward, not backward.
  const dropped = sentences.map(() => false);
  sentences.forEach((sentence, i) => {
    if (dropped[i]) return;
    if (!isRegistrationStatusSentence(sentence) || PRICE_FIGURE_RE.test(sentence)) return;
    const next = sentences[i + 1];
    if (next && BACK_REFERENCE_RE.test(next)) {
      if (!SIGN_UP_RE.test(next)) return; // would leave the follow-on dangling
      dropped[i + 1] = true;
    }
    dropped[i] = true;
  });

  const kept = [];
  sentences.forEach((sentence, i) => {
    if (dropped[i]) return;
    const [, body, tail] = sentence.match(/^([\s\S]*?)([.!?]*)$/);
    const clause = body.match(REGISTRATION_CLAUSE_RE);
    if (clause && REGISTRATION_STATUS_RE.test(clause[0]) && !PRICE_FIGURE_RE.test(clause[0])) {
      const trimmed = body.slice(0, clause.index).trim();
      kept.push(trimmed ? trimmed + (tail || '.') : sentence);
      return;
    }
    kept.push(sentence);
  });
  const out = kept.join(' ').trim();
  // allowEmpty is for list items -- a review paragraph that was nothing but
  // the claim should disappear from the array, where a summary field that
  // scrubs down to nothing must keep its original text instead.
  if (allowEmpty) return out;
  return out || text;
}

/**
 * Does this FAQ question ask whether entries are open?
 *
 * "How do I register?" and "How much does registration cost?" are process
 * and price questions -- they mention registration without asking about its
 * status, and they stay. A question asking both at once ("How much does it
 * cost to register, and is registration open?") goes: half of its answer
 * would be a claim we've stopped making, and the price it asks about is on
 * the facts table two blocks up the same page.
 */
export function isRegistrationStatusQuestion(question) {
  const q = String(question ?? '').toLowerCase();
  if (!/\b(registration|registrations|register|entries|entry|sign[- ]?ups?)\b/.test(q)) return false;
  if (!/\b(open|opens|opened|closed?|closes|closing|still|sold out|available|deadline)\b/.test(q)) return false;
  return true;
}

/**
 * FAQ list with the registration-status entries taken out: the questions
 * that ask it outright, and any question whose answer turns out to have
 * been nothing but the claim once scrubbed (an answer that empties out
 * would otherwise leave a question standing with no answer under it).
 */
export function dropRegistrationStatusFaqs(faqs = []) {
  return (Array.isArray(faqs) ? faqs : [])
    .filter((faq) => !isRegistrationStatusQuestion(faq?.question))
    .map((faq) =>
      typeof faq?.answer === 'string'
        ? { ...faq, answer: scrubRegistrationClaims(faq.answer, { allowEmpty: true }) }
        : faq
    )
    .filter((faq) => typeof faq?.answer !== 'string' || faq.answer.trim());
}

/**
 * An entity with every registration-status claim removed, in one call --
 * the core_facts field, the FAQs, the pros/cons bullets that are only that
 * claim, and the summary/description sentences carrying it.
 *
 * Every component that renders entity prose runs its own entity through
 * this (EntityCard, ListicleEntry, the detail page) rather than the pages
 * doing it before passing entities down: a component is rendered from half
 * a dozen pages, and one page forgetting the call is exactly how the claim
 * would creep back onto the site.
 *
 * NOT applied in src/lib/data.js's loaders, deliberately: the refresh and
 * generation scripts load through those same loaders and write entities
 * back to disk, so scrubbing there would silently delete the stored copy on
 * the next pipeline run.
 */
export function withoutRegistrationClaims(entity) {
  if (!entity || typeof entity !== 'object') return entity;
  const out = { ...entity };
  if (entity.core_facts && typeof entity.core_facts === 'object') {
    const { registration_status, ...facts } = entity.core_facts;
    out.core_facts = facts;
  }
  for (const field of ['ai_summary', 'short_description']) {
    if (typeof entity[field] === 'string') out[field] = scrubRegistrationClaims(entity[field]);
  }
  for (const field of ['pros', 'cons']) {
    if (Array.isArray(entity[field])) out[field] = entity[field].filter((item) => !isRegistrationStatusSentence(item));
  }
  if (Array.isArray(entity.faqs)) out.faqs = dropRegistrationStatusFaqs(entity.faqs);
  return out;
}

/**
 * The same treatment for a review record.
 *
 * A review's summary fields (dek, verdict, meta_description) are listing
 * copy by another name -- the verdict is the "bottom line" box at the top of
 * a merged race page -- so they're scrubbed exactly like an entity's
 * summary. The body paragraphs are scrubbed too, but only ever a sentence at
 * a time and never one carrying a price or one the next sentence refers back
 * to: these are cited articles, and a mangled paragraph would be a worse
 * outcome than the claim it removed. A paragraph that was nothing but the
 * claim drops out of the article entirely.
 *
 * `sections[].heading` is left alone: "Registration, Logistics and the KLIA
 * Factor" names a topic, it doesn't assert that entries are open.
 */
export function withoutRegistrationClaimsReview(review) {
  if (!review || typeof review !== 'object') return review;
  const out = { ...review };
  for (const field of ['dek', 'verdict', 'meta_description']) {
    if (typeof review[field] === 'string') out[field] = scrubRegistrationClaims(review[field]);
  }
  if (Array.isArray(review.sections)) {
    out.sections = review.sections
      .map((section) => {
        if (!Array.isArray(section?.paragraphs)) return section;
        const paragraphs = section.paragraphs
          .map((p) => (typeof p === 'string' ? scrubRegistrationClaims(p, { allowEmpty: true }) : p))
          .filter((p) => typeof p !== 'string' || p.trim());
        return { ...section, paragraphs };
      })
      // A section whose every paragraph was a status claim has nothing left
      // to say under its heading.
      .filter((section) => !Array.isArray(section?.paragraphs) || section.paragraphs.length > 0);
  }
  if (Array.isArray(review.faqs)) out.faqs = dropRegistrationStatusFaqs(review.faqs);
  return out;
}

/**
 * Do two FAQ questions ask the same thing?
 *
 * Exact-string dedupe (what the entity/review FAQ merge used to do) only
 * catches questions written character-for-character alike, which the two
 * generation stages have no reason to do. The Borobudur listing ended up
 * asking "How much does the Bank Jateng Borobudur Marathon cost?" and "How
 * much does the Borobudur Marathon cost?" one after the other, with two
 * near-identical answers -- a duplicate pair in the accordion, and a
 * duplicate entry in the FAQPage schema, which suppresses rich results
 * rather than earning them.
 *
 * The comparison keeps the leading interrogative and drops filler words,
 * then asks whether one question's remaining content words are entirely
 * contained in the other's. Keeping the interrogative is what stops "When
 * is the race?" and "Where is the race?" -- identical once stripped -- from
 * collapsing into one. Requiring containment rather than mere overlap
 * keeps "How hilly is the course?" and "How hot is the course?" apart.
 */
const QUESTION_STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'do', 'does', 'did', 'can', 'could',
  'will', 'would', 'should', 'i', 'you', 'it', 'they', 'there', 'this', 'that', 'these', 'those',
  'to', 'of', 'for', 'in', 'on', 'at', 'by', 'with', 'from', 'and', 'or', 'any', 'my', 'your',
  'get', 'got', 'have', 'has',
  // Deliberately NOT stopwords: "like" and "about" change what a question
  // is asking ("what is the course like?" is not "what makes the course
  // distinctive?"). Dropping a genuinely distinct FAQ costs more than
  // leaving a mild overlap, so the comparison stays conservative.
]);

const INTERROGATIVES = new Set(['what', 'when', 'where', 'who', 'which', 'why', 'how', 'is', 'are', 'do', 'does', 'can', 'will', 'should']);

function questionKey(question) {
  const words = String(question ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return null;
  const lead = INTERROGATIVES.has(words[0]) ? words[0] : '';
  const content = new Set(words.filter((w) => !QUESTION_STOPWORDS.has(w) && w !== lead));
  return { lead, content };
}

export function questionsAreNearDuplicates(a, b) {
  const ka = questionKey(a);
  const kb = questionKey(b);
  if (!ka || !kb) return false;
  if (ka.lead !== kb.lead) return false;
  const [small, large] = ka.content.size <= kb.content.size ? [ka.content, kb.content] : [kb.content, ka.content];
  // Two content words is the floor: a one-word question ("How long?") says
  // too little for containment to mean anything.
  if (small.size < 2) return false;
  return [...small].every((w) => large.has(w));
}

/**
 * FAQ list with near-duplicate questions removed, first occurrence winning.
 * Used wherever two FAQ sets are merged onto one page.
 */
export function dedupeFaqs(faqs = []) {
  const kept = [];
  for (const faq of faqs) {
    if (!faq?.question) continue;
    if (kept.some((k) => questionsAreNearDuplicates(k.question, faq.question))) continue;
    kept.push(faq);
  }
  return kept;
}
