import siteConfig from '../lib/config.js';
import { urls } from '../lib/urls.js';
import { loadEntities, loadCategories, loadRegions, loadListicles, stripMeta, isPublished } from '../lib/data.js';

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

  const staticPaths = [
    urls.home(),
    urls.categoriesIndex(),
    urls.regionsIndex(),
    ...(siteConfig.enabledFeatures?.listicles ? [urls.listiclesIndex()] : []),
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
  ];

  const urlEntries = [...staticPaths, ...dynamicPaths]
    .map((path) => `  <url><loc>${new URL(path, site).toString()}</loc></url>`)
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urlEntries}\n</urlset>\n`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}
