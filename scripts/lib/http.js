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
