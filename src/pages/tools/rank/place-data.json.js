import { loadFinishTimes } from '../../../lib/finishTimes.js';

/**
 * Per-race tables for the Lab's "Where would you place?" (see placeTables in
 * finishTimes.js). RankTool fetches this when someone uses the calculator,
 * so the few hundred KB of tables aren't inlined into every Lab page. It's
 * data, not a page, so it stays out of the sitemap.
 */
export function GET() {
  return new Response(JSON.stringify(loadFinishTimes().placeTables), {
    headers: { 'Content-Type': 'application/json' },
  });
}
