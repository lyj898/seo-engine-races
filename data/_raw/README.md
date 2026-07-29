# `/data/_raw` -- local scratch space only, never committed

Discovery and refresh scripts (`scripts/discover-entities.js`,
`scripts/refresh-entities.js`) may need to temporarily hold raw fetched HTML,
extracted text, or other unprocessed source material while they work.

**Rules for anything that touches this folder:**

1. This entire folder is git-ignored except this README (see root `.gitignore`).
   Nothing written here ever reaches a commit or a public site.
2. Never publish raw scraped content directly, in any circumstance. Only
   original AI-generated summaries, structured `core_facts`, and short
   attributed excerpts (via `excerpt_quotes`, with a source URL) are allowed
   into `/data/entities` and onward into the built site.
3. Always respect each source's `robots.txt`, Terms of Service, and
   reasonable rate limits (`sourceConfig.requestDelayMs` in `site.config.json`).
   Do not scrape sources that disallow it.
4. Respect copyright. Quotes must be short, clearly attributed, and used
   for commentary/reference -- not reproduction of the source's substantive
   content.
5. Treat this as scratch space that can be safely deleted at any time. Do
   not build any pipeline logic that assumes files here persist between runs.
