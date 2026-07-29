import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import siteConfig from './site.config.json' with { type: 'json' };

// `site` is read from site.config.json so every vertical instance of this
// engine only needs to edit site.config.json -- never this file -- to
// deploy under its own domain.
//
// `base` is intentionally left unset. This engine assumes each vertical
// instance deploys to its own custom domain via GitHub Pages + public/CNAME,
// not to a project-pages path like <user>.github.io/<repo>. If a future
// instance deploys WITHOUT a custom domain, set base: '/<repo-name>' here
// (and remove public/CNAME).
export default defineConfig({
  site: `https://${siteConfig.siteDomain}`,
  output: 'static',
  integrations: [tailwind()],
});
