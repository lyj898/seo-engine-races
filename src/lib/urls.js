import siteConfig from './config.js';

/**
 * Centralized URL builders. Every component and route MUST link through
 * these helpers instead of hand-writing a path, so the URL scheme only
 * ever needs to change in one place (here) rather than across every
 * component and page.
 *
 * The entity segment defaults to site.config.json's `entityLabelPlural`
 * (e.g. "races", "hotels", "courses") so entity URLs read naturally per
 * vertical -- /races/nong-khai-running-festival/ -- without this file (or
 * any component) containing a single vertical-specific word itself.
 *
 * `entityUrlSegment` overrides that default. It exists for one reason: a
 * URL that is already indexed is worth more than a tidier one. When an
 * instance replaces an existing site on the same domain, the old path
 * shape has accumulated real search equity, and renaming it silently 404s
 * every result Google is already showing. Setting this key pins the new
 * build to the old path instead of asking search engines (and anyone
 * holding a link) to rediscover the whole directory.
 *
 * `categories`, `regions`, and `best` are structural site-section names,
 * not vertical words, so they stay generic across every instance.
 */
const entitySegment = siteConfig.entityUrlSegment ?? siteConfig.entityLabelPlural;

// Re-exported so the dynamic [entityType] route resolves its param from the
// exact same value these link builders use. If the route derived it
// independently the two could disagree, and every entity link would point at
// a path that was never generated.
export const entityUrlSegment = entitySegment;

// Astro's import.meta.env.BASE_URL mirrors astro.config.mjs's `base` option
// (always normalized to end with a trailing slash -- '/' when base is unset,
// e.g. '/seo-engine-races/' when it's set for a project-pages preview). Every
// path below is written as an absolute '/foo/' string for readability, then
// run through withBase() so it still resolves correctly if this instance is
// ever deployed under a base path instead of its own custom domain -- e.g.
// the temporary lyj898.github.io/seo-engine-races/ preview (see astro.config.mjs).
const withBase = (path) => import.meta.env.BASE_URL + path.replace(/^\//, '');

export const urls = {
  home: () => withBase('/'),
  categoriesIndex: () => withBase('/categories/'),
  category: (slug) => withBase(`/categories/${slug}/`),
  regionsIndex: () => withBase('/regions/'),
  region: (slug) => withBase(`/regions/${slug}/`),
  entitiesIndex: () => withBase(`/${entitySegment}/`),
  entity: (slug) => withBase(`/${entitySegment}/${slug}/`),
  listiclesIndex: () => withBase('/best/'),
  listicle: (slug) => withBase(`/best/${slug}/`),
  about: () => withBase('/about/'),
  privacy: () => withBase('/privacy/'),
  terms: () => withBase('/terms/'),
  contact: () => withBase('/contact/'),
};
