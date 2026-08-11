import siteConfig from '../lib/config.js';
import { urls } from '../lib/urls.js';
import { TOOLS } from '../lib/tools.js';
import { loadEntities, loadCategories, loadRegions, loadListicles, loadReviews, loadGear, loadArticles, stripMeta, isPublished } from '../lib/data.js';

/**
 * Build-time-generated sitemap, enumerating every real route this engine
 * produces -- static pages, plus every active entity/category/region/
 * listicle from /data. Uses the same `urls` helpers every page/component
 * uses, so the sitemap can never drift out of sync with actual routes.
 */
export async function GET({ site }) {
  const entities = loadEntities().map(stripMeta).filter(isPublished);
  const categories = loadCategories().map(stripMeta).filter(isPublished);
  const regions = loadRegions().map(stripMeta).filter(isPublished);
  const listicles = loadListicles().map(stripMeta).filter(isPublished);
  const entityIds = new Set(entities.map((e) => e.entity_id));
  const reviews = siteConfig.enabledFeatures?.reviews
    ? loadReviews().map(stripMeta).filter(isPublished).filter((r) => entityIds.has(r.entity_id))
    : [];
  const gearArticles = siteConfig.enabledFeatures?.gear ? loadGear().map(stripMeta).filter(isPublished) : [];
  const articles = siteConfig.enabledFeatures?.articles ? loadArticles().map(stripMeta).filter(isPublished) : [];

  const staticPaths = [
    urls.home(),
    urls.categoriesIndex(),
    urls.regionsIndex(),
    ...(siteConfig.enabledFeatures?.listicles ? [urls.listiclesIndex()] : []),
    ...(siteConfig.enabledFeatures?.reviews ? [urls.reviewsIndex()] : []),
    ...(siteConfig.enabledFeatures?.gear ? [urls.gearIndex()] : []),
    ...(siteConfig.enabledFeatures?.articles ? [urls.articlesIndex()] : []),
    ...(siteConfig.enabledFeatures?.travelAgencies ? [urls.travelIndex()] : []),
    urls.toolsIndex(),
    ...TOOLS.map((t) => urls.tool(t.slug)),
    urls.about(),
    urls.privacy(),
    urls.terms(),
    urls.contact(),
  ];

  const dynamicPaths = [
    ...categories.map((c) => urls.category(c.slug)),
    ...regions.map((r) => urls.region(r.slug)),
    ...entities.map((e) => urls.entity(e.slug)),
    ...(siteConfig.enabledFeatures?.listicles ? listicles.map((l) => urls.listicle(l.slug)) : []),
    ...reviews.map((r) => urls.review(r.slug)),
    ...gearArticles.map((a) => urls.gear(a.slug)),
    ...articles.map((a) => urls.article(a.slug)),
  ];

  const urlEntries = [...staticPaths, ...dynamicPaths]
    .map((path) => `  <url><loc>${new URL(path, site).toString()}</loc></url>`)
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urlEntries}\n</urlset>\n`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}
