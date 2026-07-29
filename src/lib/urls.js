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

export const urls = {
  home: () => '/',
  categoriesIndex: () => '/categories/',
  category: (slug) => `/categories/${slug}/`,
  regionsIndex: () => '/regions/',
  region: (slug) => `/regions/${slug}/`,
  entitiesIndex: () => `/${entitySegment}/`,
  entity: (slug) => `/${entitySegment}/${slug}/`,
  listiclesIndex: () => '/best/',
  listicle: (slug) => `/best/${slug}/`,
  about: () => '/about/',
  privacy: () => '/privacy/',
  terms: () => '/terms/',
  contact: () => '/contact/',
};
