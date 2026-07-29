/**
 * Shared constants between discover-entities.js and generate-summaries.js.
 * Pulled into one file so the two scripts can never drift out of sync on
 * what "still needs a summary" means.
 */

// discover-entities.js writes this into ai_summary for a newly-found entity
// (base schema requires ai_summary to be a non-empty string, but discovery's
// job is only to find structured facts -- generate-summaries.js writes the
// real summary). generate-summaries.js treats any entity whose ai_summary
// is exactly this string as needing generation.
export const PENDING_SUMMARY_MARKER = '(AI summary pending -- run `npm run summaries`.)';

// Conservative starting reliability_score for a freshly discovered,
// not-yet-human-reviewed entity. refresh-entities.js and human review both
// adjust this upward/downward over time; discovery never guesses higher.
export const DRAFT_RELIABILITY_SCORE = 40;
