import siteConfig from './config.js';
import { urls } from './urls.js';

/**
 * The site's section links, defined once.
 *
 * Header and Footer each used to carry their own copy of this list, and they
 * drifted: "Reviews" was in the top nav but missing from the footer, so a
 * whole section had exactly one internal entry point on every page. That is
 * both a reader problem and a crawl problem -- the footer is the link block
 * that appears on every URL, which is precisely what makes it worth keeping
 * complete.
 *
 * Each link is gated by the same enabledFeatures flag that decides whether
 * its pages get built, so turning a section off can't leave a link behind in
 * one place and not the other.
 *
 * `footerOnly`/`headerOnly` exist for the few links that genuinely belong in
 * one chrome and not the other (the legal pages are footer material; nobody
 * puts Terms in a top nav). Everything else appears in both by construction.
 */
export function buildSectionLinks() {
  return [
    { href: urls.regionsIndex(), label: siteConfig.regionLabelPlural ?? `${siteConfig.regionLabel}s` },
    { href: urls.categoriesIndex(), label: `${siteConfig.categoryLabel}s`, footerOnly: true },
    ...(siteConfig.enabledFeatures?.listicles ? [{ href: urls.listiclesIndex(), label: 'Recommends' }] : []),
    ...(siteConfig.enabledFeatures?.reviews ? [{ href: urls.reviewsIndex(), label: 'Reviews' }] : []),
    ...(siteConfig.enabledFeatures?.gear ? [{ href: urls.gearIndex(), label: 'Gear' }] : []),
    ...(siteConfig.enabledFeatures?.articles ? [{ href: urls.articlesIndex(), label: 'Articles' }] : []),
    ...(siteConfig.enabledFeatures?.travelAgencies ? [{ href: urls.travelIndex(), label: 'Travel' }] : []),
    { href: urls.toolsIndex(), label: 'Lab' },
    { href: urls.about(), label: 'About', headerOnly: true },
  ];
}

export const headerLinks = () => buildSectionLinks().filter((l) => !l.footerOnly);
export const footerLinks = () => buildSectionLinks().filter((l) => !l.headerOnly);
