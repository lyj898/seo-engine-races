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
    // The header carries four sections: Races (countries + reviews; the
    // calendar itself is the homepage), Lab (the finish-time ranking tool plus
    // the calculators), Clubs (running clubs and coaches) and Articles (our
    // articles incl. gear and best-of lists, pieces we wrote for other
    // publications, and sites that cite us). Renamed/refocused Nov 2026; Training
    // became Clubs (Alex, 6 Nov 2026) so all four labels are short nouns.
    { href: urls.regionsIndex(), label: 'Races', headerOnly: true },
    { href: urls.toolsIndex(), label: 'Lab', headerOnly: true },
    ...(f.clubs ? [{ href: urls.clubsIndex(), label: 'Clubs', headerOnly: true }] : []),
    ...(f.articles ? [{ href: urls.articlesIndex(), label: 'Articles', headerOnly: true }] : []),
    // The footer keeps a link to every section -- it is the one link block on
    // every URL, which is what lets crawlers reach all of them.
    { href: urls.regionsIndex(), label: 'Races by country', footerOnly: true },
    { href: urls.categoriesIndex(), label: `Races by ${siteConfig.categoryLabel.toLowerCase()}`, footerOnly: true },
    ...(f.reviews ? [{ href: urls.reviewsIndex(), label: 'Race reviews', footerOnly: true }] : []),
    { href: urls.toolsIndex(), label: 'Lab: how do you stack up?', footerOnly: true },
    ...(f.clubs ? [{ href: urls.clubsIndex(), label: 'Running clubs and coaches', footerOnly: true }] : []),
    ...(f.articles ? [{ href: urls.articlesIndex(), label: 'Articles', footerOnly: true }] : []),
    ...(f.cancellations ? [{ href: urls.cancellations(), label: 'Race cancellations', footerOnly: true }] : []),
  ];
}

export const headerLinks = () => buildSectionLinks().filter((l) => !l.footerOnly);
export const footerLinks = () => buildSectionLinks().filter((l) => !l.headerOnly);
