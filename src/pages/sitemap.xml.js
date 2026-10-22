import siteConfig from '../lib/config.js';
import { urls } from '../lib/urls.js';
import { TOOLS } from '../lib/tools.js';
import { loadEntities, loadCategories, loadRegions, loadListicles, loadReviews, loadGear, loadArticles, loadClubCities, stripMeta, isPublished, isReviewableEntity, buildRegionEntityCounts, regionHasEntities } from '../lib/data.js';

/**
 * Build-time-generated sitemap, enumerating every real route this engine
 * produces -- static pages, plus every active entity/category/region/
 * listicle from /data. Uses the same `urls` helpers every page/component
 * uses, so the sitemap can never drift out of sync with actual routes.
 */
export async function GET({ site }) {
  const entities = loadEntities().map(stripMeta).filter(isPublished);
  const categories = loadCategories().map(stripMeta).filter(isPublished);
  const allRegions = loadRegions().map(stripMeta).filter(isPublished);
  const listicles = loadListicles().map(stripMeta).filter(isPublished);
  // A region page whose listing is empty is thin content by construction --
  // it exists, but there is nothing on it to rank. It stays built (an
  // already-crawled URL is better served by an honest empty state than by a
  // new 404) and simply isn't submitted; regionHasEntities in src/lib/data.js
  // is the same gate the hub grids and the homepage counts use.
  const regionCounts = buildRegionEntityCounts(allRegions, entities);
  const regions = allRegions.filter((r) => regionHasEntities(r, regionCounts));
  const entityIds = new Set(entities.map((e) => e.entity_id));

  // Editions that have already been run. [entityType]/[slug].astro builds a
  // page for every non-draft entity, so these URLs exist and serve real
  // content behind a "this edition has already taken place" banner.
  //
  // They belong in the sitemap even though they aren't the site's shop
  // window: Google already has them -- they are, measured, where most of the
  // site's clicks were landing before the pages were kept -- and submitting
  // them is what asks for the recrawl that turns a remembered 404 back into a
  // live page. Sorted newest-first so the most recently run editions, the
  // ones still drawing "results"/"photos" traffic, lead.
  const lapsedEntities = loadEntities()
    .map(stripMeta)
    .filter(isReviewableEntity)
    .filter((e) => !entityIds.has(e.entity_id))
    .sort((a, b) => String(b.core_facts?.date ?? '').localeCompare(String(a.core_facts?.date ?? '')));

  const reviews = siteConfig.enabledFeatures?.reviews
    ? loadReviews().map(stripMeta).filter(isPublished).filter((r) => entityIds.has(r.entity_id))
    : [];
  const gearArticles = siteConfig.enabledFeatures?.gear ? loadGear().map(stripMeta).filter(isPublished) : [];
  const articles = siteConfig.enabledFeatures?.articles ? loadArticles().map(stripMeta).filter(isPublished) : [];
  const clubCities = siteConfig.enabledFeatures?.clubs ? loadClubCities().map(stripMeta).filter(isPublished) : [];

  const staticPaths = [
    urls.home(),
    urls.categoriesIndex(),
    urls.regionsIndex(),
    ...(siteConfig.enabledFeatures?.listicles ? [urls.listiclesIndex()] : []),
    ...(siteConfig.enabledFeatures?.reviews ? [urls.reviewsIndex()] : []),
    ...(siteConfig.enabledFeatures?.gear ? [urls.gearIndex()] : []),
    ...(siteConfig.enabledFeatures?.articles ? [urls.articlesIndex()] : []),
    ...(siteConfig.enabledFeatures?.travelAgencies ? [urls.travelIndex()] : []),
    ...(clubCities.length > 0 ? [urls.clubsIndex()] : []),
    ...(siteConfig.enabledFeatures?.cancellations ? [urls.cancellations()] : []),
    urls.toolsIndex(),
    ...TOOLS.map((t) => urls.tool(t.slug)),
    urls.about(),
    urls.privacy(),
    urls.terms(),
    urls.contact(),
  ];

  // <lastmod> is the main hint Google uses to decide what to recrawl, so each
  // record-backed page carries the newest date that changes what it shows:
  // the record itself, plus for a race page its merged review and its results
  // check. Hub and static pages get none rather than a guessed date -- a
  // lastmod that moves on every build teaches Google to ignore it.
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  const newest = (...dates) => dates.filter((d) => ISO_DATE.test(String(d ?? ''))).sort().at(-1);
  const mergedReviewDate = new Map(
    siteConfig.enabledFeatures?.mergedReviews
      ? loadReviews().map(stripMeta).filter(isPublished).map((r) => [r.entity_id, r.last_updated])
      : [],
  );
  const entityLastmod = (e) => newest(e.last_updated, mergedReviewDate.get(e.entity_id), e.results?.last_checked);

  const dynamicPaths = [
    ...categories.map((c) => urls.category(c.slug)),
    ...regions.map((r) => urls.region(r.slug)),
    ...entities.map((e) => [urls.entity(e.slug), entityLastmod(e)]),
    ...lapsedEntities.map((e) => [urls.entity(e.slug), entityLastmod(e)]),
    ...(siteConfig.enabledFeatures?.listicles ? listicles.map((l) => [urls.listicle(l.slug), newest(l.last_updated)]) : []),
    // Every review URL is omitted when mergedReviews is on, because every one
    // of them now redirects to an entity page listed above -- and sitemapping
    // a redirect spends crawl budget to be told where the real page is. This
    // used to carve out reviews of archived races, whose entity page was not
    // built and which therefore served the article rather than redirecting;
    // lapsedEntities above is that case now, listed as the listing URL it
    // actually resolves to.
    ...(siteConfig.enabledFeatures?.mergedReviews ? [] : reviews.map((r) => urls.review(r.slug))),
    ...gearArticles.map((a) => [urls.gear(a.slug), newest(a.last_updated)]),
    ...articles.map((a) => [urls.article(a.slug), newest(a.last_updated)]),
    ...clubCities.map((c) => [urls.clubCity(c.slug), newest(c.last_updated)]),
  ];

  const urlEntries = [...staticPaths, ...dynamicPaths]
    .map((entry) => {
      const [path, lastmod] = Array.isArray(entry) ? entry : [entry];
      const mod = lastmod ? `<lastmod>${lastmod}</lastmod>` : '';
      return `  <url><loc>${new URL(path, site).toString()}</loc>${mod}</url>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urlEntries}\n</urlset>\n`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}
