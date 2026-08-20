/**
 * Minimal, dependency-free HTTP + HTML helpers for the discover/refresh
 * scripts. No cheerio/axios/jsdom -- Node 18+'s built-in `fetch` plus a
 * couple of regexes are enough for "strip a page down to readable text and
 * hand it to Claude," and it keeps this engine's dependency footprint
 * small. None of this is vertical-specific.
 */

const FETCH_TIMEOUT_MS = 15_000;

/** Fetches a URL as text, with a timeout and a descriptive error on failure. */
export async function fetchText(url, { userAgent } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: userAgent ? { 'User-Agent': userAgent } : undefined,
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

const HTML_ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

/**
 * Crude HTML -> plain text: drops <script>/<style>/<head>, strips all
 * remaining tags, decodes a handful of common entities, collapses
 * whitespace. Good enough to hand page content to an LLM for extraction;
 * not a real HTML parser, so it will occasionally mangle unusual markup.
 * That's an acceptable tradeoff for a zero-dependency scraper -- Claude is
 * the one doing the actual "understanding," this just removes markup noise.
 */
export function htmlToText(html) {
  let text = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|head)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  text = text.replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
  for (const [entity, char] of Object.entries(HTML_ENTITIES)) {
    text = text.split(entity).join(char);
  }

  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * Extracts <a href="..."> links (absolute-resolved against baseUrl) with
 * their visible text. Used by discover-entities.js to find candidate
 * detail-page URLs on an aggregator's listing page.
 */
export function extractLinks(html, baseUrl) {
  const links = [];
  const re = /<a\s+[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = re.exec(html))) {
    const [, href, innerHtml] = match;
    let url;
    try {
      url = new URL(href, baseUrl).toString();
    } catch {
      continue; // malformed href (mailto:, javascript:, etc.) -- skip, don't crash
    }
    const text = htmlToText(innerHtml).replace(/\s+/g, ' ').trim();
    if (text) links.push({ url, text });
  }
  return links;
}

/** Truncates source text to a character budget before sending to Claude. */
export function truncateForPrompt(text, maxChars = 6000) {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '\n...[truncated]';
}

/**
 * A prompt-sized window of `text` centred on the first mention of `needle`,
 * falling back to the start of the text when it isn't mentioned.
 *
 * For the re-verification pass, which reads one page looking for one
 * record. Where that page is a country race calendar rather than an event's
 * own site, the row being re-checked is very often past the first 6,000
 * characters -- so the model was handed a page that genuinely did list the
 * race, could not see it, and the entity got marked as no longer confirmed.
 * Chunking the whole page would multiply the cost of every refresh by the
 * length of the page; centring the window on the record costs nothing extra
 * and answers the question actually being asked.
 */
export function focusForPrompt(text, needle, maxChars = 6000) {
  const source = String(text ?? '');
  if (source.length <= maxChars) return source;
  const at = typeof needle === 'string' && needle.trim()
    ? source.toLowerCase().indexOf(needle.trim().toLowerCase())
    : -1;
  if (at === -1) return truncateForPrompt(source, maxChars);
  // Keep a third of the budget before the mention so surrounding context
  // (a month heading the row sits under, say) comes along with it.
  const start = Math.max(0, at - Math.floor(maxChars / 3));
  const slice = source.slice(start, start + maxChars);
  return (start > 0 ? '...[earlier content omitted]\n' : '') + slice + (start + maxChars < source.length ? '\n...[truncated]' : '');
}

/**
 * Splits source text into successive chunks that each fit a prompt budget,
 * so a long page can be read in full rather than only from the top.
 *
 * WHY THIS EXISTS
 * truncateForPrompt() above quietly capped what discovery could ever find.
 * A country race calendar is one long list, and the extraction prompt only
 * ever saw its first 6,000 characters: justrunlah's Thailand calendar was
 * cut to 31% of its rows, Indonesia to 34%, Vietnam to 55%, and the AIMS
 * world calendar to 19%. Those are exactly the countries the directory was
 * thinnest in -- 25 Thai races and 10 Vietnamese ones against calendars
 * that run to hundreds. The pipeline was not failing to find them; it was
 * never being shown them.
 *
 * Chunks are cut on a whitespace boundary near the budget where one exists,
 * so a race name or date is not sliced down the middle and lost from both
 * halves. `overlapChars` repeats a little of the previous chunk's tail for
 * the same reason -- an entry straddling a boundary appears whole in the
 * second chunk. Duplicate candidates across the overlap are cheap to drop;
 * a half-read one is not recoverable.
 *
 * maxChunks bounds the cost: extraction is one model call per chunk, so an
 * enormous page costs a bounded number of calls rather than an unbounded
 * one.
 */
export function chunkForPrompt(text, { chunkChars = 6000, maxChunks = 8, overlapChars = 200 } = {}) {
  const source = String(text ?? '');
  if (!source) return [];
  if (source.length <= chunkChars) return [source];

  const chunks = [];
  let start = 0;
  while (start < source.length && chunks.length < maxChunks) {
    let end = Math.min(start + chunkChars, source.length);
    if (end < source.length) {
      // Prefer a whitespace break in the last 10% of the window; fall back
      // to the hard cut if the text has no whitespace there at all.
      const window = source.slice(start, end);
      const breakAt = window.lastIndexOf(' ', chunkChars);
      if (breakAt > chunkChars * 0.9) end = start + breakAt;
    }
    chunks.push(source.slice(start, end));
    if (end >= source.length) break;
    start = Math.max(end - overlapChars, start + 1);
  }
  return chunks;
}
