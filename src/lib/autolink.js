/**
 * Shared prose-autolinking helpers, used by every component that renders
 * free-text (body paragraphs, FAQ answers, hub intros) against
 * buildRaceLinkTargets() (see data.js). Pulled out of ReviewArticle.astro so
 * FAQSection.astro and plain intro paragraphs can link race names the exact
 * same way -- one set of rules, one dedup mechanism, instead of body prose
 * being the only place a race name turns into a link.
 *
 * Deliberately Astro-free (same rule as data.js) so it's usable from any
 * .astro file's frontmatter as well as from component templates.
 */

export function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Defensively strip artifacts a web-search-backed model can leak: <cite>
// wrapper tags and compound/hyphenated citation refs like [16-8] or
// [11-3,11-4] that point at internal retrieval chunks rather than a real
// sources[] list. validate-data rejects these at build time, but stripping
// here too means a bad record can never render raw markup to a reader.
export function cleanArtifacts(text) {
  return text
    .replace(/<\/?cite[^>]*>/gi, '')
    .replace(/\[\d+-[^\]]*\]/g, ''); // drop hyphenated chunk refs like [16-8]; keep [n] and [n,m]
}

/**
 * Turns buildRaceLinkTargets()'s { name, reviewSlug } pairs into the
 * { name, url } list autolinkText() walks -- deduped by name, longest name
 * first (so a full race name matches before a shorter alias that's also a
 * substring of it -- e.g. one race's full name can genuinely contain a
 * *different* race's whole name, like "Tangkak Merdeka Half Marathon 2026"
 * containing "Merdeka Half Marathon 2026"; trying candidates longest-first
 * at every position is what keeps that from linking to the wrong race).
 *
 * The current page's own review gets url: null rather than being dropped
 * from the list entirely -- autolinkText still needs to recognise the
 * race's own name as a match (so it can consume that span as plain text)
 * even though it won't turn it into a link, otherwise a shorter *other*
 * race's name sitting inside it would be free to match instead.
 */
export function prepareRaceLinks(raceLinks, urls, currentReviewSlug = null) {
  return [...new Map(
    raceLinks.map((r) => [
      r.name,
      { name: r.name, url: r.reviewSlug === currentReviewSlug ? null : urls.review(r.reviewSlug) },
    ])
  ).values()].sort((a, b) => b.name.length - a.name.length);
}

/**
 * Single left-to-right pass over already-escaped text: at every position,
 * tries each candidate name (longest first) for a literal match starting
 * right there, and on a hit emits either a link or (for an already-linked-
 * elsewhere race, or the page's own self-referenced race) the plain name --
 * either way advancing past the whole matched span before continuing.
 *
 * Scanning this way, instead of running an independent indexOf() per
 * candidate against the whole text, is what makes overlapping race names
 * safe: once a span is claimed by its best (longest) match, no shorter
 * candidate -- for this race or a different one -- can match *inside* it.
 * That rules out both a same-race alias re-linking part of an already-
 * linked mention, and a completely different, shorter race name that
 * happens to sit inside a longer race's name being mistaken for a real
 * mention of it.
 *
 * Only ever inserts markup built from sortedRaceLinks (never from the text
 * itself), so this can't become an HTML-injection path.
 *
 * alreadyLinkedUrls is tracked by URL, not by name, and is meant to be
 * shared across every autolinkText() call for one page render (body
 * paragraphs, then FAQ answers, then any intro text) so a race is linked at
 * most once per page, wherever its first mention actually falls.
 */
export function autolinkText(escapedText, sortedRaceLinks, alreadyLinkedUrls) {
  if (sortedRaceLinks.length === 0) return escapedText;

  const candidates = sortedRaceLinks.map(({ name, url }) => ({ escapedName: escapeHtml(name), url }));

  let result = '';
  let i = 0;
  while (i < escapedText.length) {
    const hit = candidates.find(({ escapedName }) => escapedText.startsWith(escapedName, i));
    if (!hit) {
      result += escapedText[i];
      i += 1;
      continue;
    }
    if (hit.url && !alreadyLinkedUrls.has(hit.url)) {
      result += `<a href="${hit.url}" class="link-accent">${hit.escapedName}</a>`;
      alreadyLinkedUrls.add(hit.url);
    } else {
      result += hit.escapedName;
    }
    i += hit.escapedName.length;
  }
  return result;
}
