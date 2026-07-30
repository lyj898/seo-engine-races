import siteConfig from './config.js';

/**
 * Centralized URL builders. Every component and route MUST link through
 * these helpers instead of hand-writing a path, so the URL scheme only
 * ever needs to change in one place (here) rather than across every
 * component and page.
 *
 * The entity segment uses site.config.json's `entityLabelPlural` (e.g.
 * "races", "hotels", "courses") so entity URLs read naturally per vertical
 * -- runsea.run/races/nong-khai-running-festival/ -- without this file (or
 * any component) containing a single vertical-specific word itself.
 *
 * `categories`, `regions`, and `best` are structural site-section names,
 * not vertical words, so they stay generic across every instance.
 */
const entitySegment = siteConfig.entityLabelPlural;

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
