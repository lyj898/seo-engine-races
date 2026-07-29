/**
 * Build-time-generated robots.txt (replaces the old static public/robots.txt
 * placeholder from Step 1). Reads the sitemap URL from Astro's `site`
 * (itself derived from site.config.json.siteDomain via astro.config.mjs),
 * so no vertical instance ever hand-edits a hardcoded domain here.
 *
 * Policy: explicitly ALLOW major search and AI crawlers. Programmatic-SEO
 * content is meant to be found and cited by both search engines and AI
 * assistants -- never accidentally block GPTBot / ClaudeBot /
 * PerplexityBot / etc.
 */
const ALLOWED_AGENTS = [
  '*',
  'Googlebot',
  'Bingbot',
  'GPTBot',
  'ChatGPT-User',
  'ClaudeBot',
  'anthropic-ai',
  'PerplexityBot',
  'Google-Extended',
  'CCBot',
];

export async function GET({ site }) {
  const sitemapUrl = new URL('sitemap.xml', site).toString();
  const body =
    ALLOWED_AGENTS.map((agent) => `User-agent: ${agent}\nAllow: /`).join('\n\n') + `\n\nSitemap: ${sitemapUrl}\n`;

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
