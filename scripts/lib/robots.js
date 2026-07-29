/**
 * Minimal robots.txt fetcher/parser. Not a full spec implementation (no
 * wildcard `*`/`$` matching inside paths, no crawl-delay parsing since we
 * use site.config.json's own requestDelayMs instead) -- but it correctly
 * handles the common case: named user-agent groups, `*` fallback group,
 * Allow/Disallow prefix rules, longest-match-wins. Good enough to honor
 * the "respect robots.txt" requirement without a new dependency.
 *
 * Convention (standard practice): if robots.txt can't be fetched at all
 * (404, network error, timeout), treat the site as allowing everything --
 * absence of a robots.txt is not a signal to disallow. If it fetches fine,
 * its rules are followed exactly.
 */
import { fetchText } from './http.js';

const cache = new Map(); // origin -> parsed rule groups (or null = "allow all")

function parseRobotsTxt(text) {
  const groups = []; // { agents: string[], rules: { allow: string[], disallow: string[] } }
  let current = null;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.split('#')[0].trim();
    if (!line) continue;
    const [rawKey, ...rest] = line.split(':');
    if (!rawKey || rest.length === 0) continue;
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(':').trim();

    if (key === 'user-agent') {
      // A run of consecutive User-agent lines belongs to the same group.
      if (!current || current.rules.allow.length || current.rules.disallow.length) {
        current = { agents: [], rules: { allow: [], disallow: [] } };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (key === 'disallow' && current) {
      if (value !== '') current.rules.disallow.push(value);
    } else if (key === 'allow' && current) {
      if (value !== '') current.rules.allow.push(value);
    }
  }

  return groups;
}

function matchesAgent(groupAgents, userAgent) {
  const ua = userAgent.toLowerCase();
  // Match on product token (text before the first "/"), the same way real
  // crawlers identify themselves, e.g. our own
  // "programmatic-seo-engine/1.0 (+https://...)" matches a robots.txt group
  // for "programmatic-seo-engine".
  const productToken = ua.split('/')[0].trim();
  return groupAgents.some((a) => a === '*' || ua.includes(a) || productToken === a);
}

function isPathAllowed(path, groups, userAgent) {
  const specific = groups.filter((g) => g.agents.includes('*') === false && matchesAgent(g.agents, userAgent));
  const wildcard = groups.filter((g) => g.agents.includes('*'));
  const applicable = specific.length > 0 ? specific : wildcard;
  if (applicable.length === 0) return true; // no rules for us at all -> allowed

  let bestMatch = { length: -1, allowed: true };
  for (const group of applicable) {
    for (const rule of group.rules.disallow) {
      if (path.startsWith(rule) && rule.length > bestMatch.length) {
        bestMatch = { length: rule.length, allowed: false };
      }
    }
    for (const rule of group.rules.allow) {
      if (path.startsWith(rule) && rule.length > bestMatch.length) {
        bestMatch = { length: rule.length, allowed: true };
      }
    }
  }
  return bestMatch.allowed;
}

export async function isAllowed(url, userAgent) {
  const { origin, pathname, search } = new URL(url);
  if (!cache.has(origin)) {
    try {
      const text = await fetchText(`${origin}/robots.txt`, { userAgent });
      cache.set(origin, parseRobotsTxt(text));
    } catch {
      cache.set(origin, null); // couldn't fetch -> allow-all convention
    }
  }
  const groups = cache.get(origin);
  if (!groups) return true;
  return isPathAllowed(pathname + search, groups, userAgent);
}
