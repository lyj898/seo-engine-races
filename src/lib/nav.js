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
  const f = siteConfig.enabledFeatures ?? {};
  return [
    // The header carries four sections (Alex, Oct 2026): Races (countries +
    // reviews; the calendar itself is the homepage), Lab (the finish-time
    // ranking tool plus the calculators), Training (clubs, training articles,
    // gear) and Guides (race guides, best-of lists, race travel).
    { href: urls.regionsIndex(), label: 'Races', headerOnly: true },
    { href: urls.toolsIndex(), label: 'Lab', headerOnly: true },
    ...(f.clubs ? [{ href: urls.clubsIndex(), label: 'Training', headerOnly: true }] : []),
    ...(f.articles ? [{ href: urls.articlesIndex(), label: 'Guides', headerOnly: true }] : []),
    // The footer keeps a link to every section -- it is the one link block on
    // every URL, which is what lets crawlers reach all of them.
    { href: urls.regionsIndex(), label: 'Races by country', footerOnly: true },
    { href: urls.categoriesIndex(), label: `Races by ${siteConfig.categoryLabel.toLowerCase()}`, footerOnly: true },
    ...(f.reviews ? [{ href: urls.reviewsIndex(), label: 'Race reviews', footerOnly: true }] : []),
    ...(f.listicles ? [{ href: urls.listiclesIndex(), label: 'Best-of lists', footerOnly: true }] : []),
    { href: urls.toolsIndex(), label: 'Lab: how do you stack up?', footerOnly: true },
    ...(f.clubs ? [{ href: urls.clubsIndex(), label: 'Running clubs and training', footerOnly: true }] : []),
    ...(f.articles ? [{ href: urls.articlesIndex(), label: 'Guides and articles', footerOnly: true }] : []),
    ...(f.gear ? [{ href: urls.gearIndex(), label: 'Gear', footerOnly: true }] : []),
    ...(f.travelAgencies ? [{ href: urls.travelIndex(), label: 'Race travel', footerOnly: true }] : []),
    ...(f.cancellations ? [{ href: urls.cancellations(), label: 'Race cancellations', footerOnly: true }] : []),
  ];
}

export const headerLinks = () => buildSectionLinks().filter((l) => !l.footerOnly);
export const footerLinks = () => buildSectionLinks().filter((l) => !l.headerOnly);
