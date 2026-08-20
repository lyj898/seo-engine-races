/**
 * When may a score be shown to a reader?
 *
 * The site publishes an at-a-glance rating in three places: the "How
 * runners rate it" breakdown on a listing, the same block on a standalone
 * review, and the score badge on a guide entry. All three are captioned as
 * runner/participant sentiment -- "Scores summarise sentiment from the
 * participant reviews cited above" -- and the about page promises that
 * nothing is generated beyond the attached source facts.
 *
 * That promise was not being kept. 196 of the 213 rated reviews cite no
 * participant-review source at all: the Borobudur listing, for instance,
 * showed "How runners rate it -- 82/100" broken into Course, Organisation,
 * Atmosphere and Weather above three references that were the official race
 * site, a race calendar and the AIMS calendar. There were no participant
 * reviews above it to summarise. A score with nothing behind it is the
 * single most damaging thing an editorially-careful directory can publish:
 * a reader who notices stops trusting the facts too, and it is squarely
 * what the helpful-content guidance is aimed at.
 *
 * So a score is displayable only where the page it sits on actually shows
 * the participant material it claims to summarise. Any one of these counts,
 * because each renders on the page beside the score:
 *
 *   - a cited source typed `review` or `social` (a race report, a runner's
 *     blog, a forum or social post) in the review's references list;
 *   - a `pull_quote` on the review -- a short attributed excerpt;
 *   - an `excerpt_quote` on the entity -- the same thing gathered by the
 *     research stage and rendered as "What people say".
 *
 * Everything else keeps its rating in the data (it is still a useful
 * internal ranking signal, and guides still sort by it) but does not print
 * it as though runners had said it.
 *
 * Deliberately generic: nothing here knows what a race is. Any vertical
 * whose reviews carry sources/quotes gets the same gate.
 */

const PARTICIPANT_SOURCE_TYPES = new Set(['review', 'social']);

export function hasParticipantEvidence({ review, entity } = {}) {
  if (review?.sources?.some((s) => PARTICIPANT_SOURCE_TYPES.has(s?.type))) return true;
  if (review?.pull_quotes?.length > 0) return true;
  if (entity?.excerpt_quotes?.length > 0) return true;
  return false;
}

/**
 * The rating to render, or null. Callers pass whichever rating they would
 * otherwise have shown; this returns it only when the evidence gate above
 * is satisfied, so no page has to remember to apply the rule itself.
 */
export function displayableRating(rating, { review, entity } = {}) {
  if (!rating || typeof rating.overall !== 'number') return null;
  return hasParticipantEvidence({ review, entity }) ? rating : null;
}

/**
 * Strips a baked "(85/100)" score out of editorial prose.
 *
 * Guide copy is written with the score inline ("Our top pick is the Penang
 * Bridge International Marathon (85/100)"), which quietly reintroduces the
 * same unbacked claim the gate above just removed -- and in a sentence, where
 * it reads as even more authoritative than the badge did.
 */
export function stripInlineScore(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/\s*\(\s*\d{1,3}\s*\/\s*100\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
