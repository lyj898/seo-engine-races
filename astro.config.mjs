import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import siteConfig from './site.config.json' with { type: 'json' };

// `site` is read from site.config.json so every vertical instance of this
// engine only needs to edit site.config.json -- never this file -- to
// deploy under its own domain.
//
// `base` is intentionally left unset. This engine deploys each vertical
// instance to its own custom domain via GitHub Pages + public/CNAME, so
// every link and asset path is served from the domain root.
//
// (The temporary PREVIEW_BASE_PATH override that prefixed every path with
// /seo-engine-races/ for the pre-launch preview has been removed now that
// runsea.run serves this build directly.)

export default defineConfig({
  site: `https://${siteConfig.siteDomain}`,
  output: 'static',
  integrations: [tailwind()],
  // Pace Lab's calculators previously lived at individual URLs, then got
  // folded onto one JS-tabbed /tools/ page (see the now-removed redirect
  // that used to live here), which turned out to be an SEO regression: one
  // URL/H1/meta description can't rank for five different high-intent
  // searches ("marathon pace calculator", "race time predictor", etc). Each
  // calculator is back on its own real, indexable page under /tools/ --
  // /tools/ itself is now a hub linking to all of them, so no redirect is
  // needed this time.
});
