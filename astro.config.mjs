import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import siteConfig from './site.config.json' with { type: 'json' };

// `site` is read from site.config.json so every vertical instance of this
// engine only needs to edit site.config.json -- never this file -- to
// deploy under its own domain.
//
// `base` is intentionally left unset for production. This engine assumes
// each vertical instance deploys to its own custom domain via GitHub Pages +
// public/CNAME, not to a project-pages path like <user>.github.io/<repo>.
//
// TEMPORARY PREVIEW OVERRIDE: while this instance is being reviewed at
// https://lyj898.github.io/seo-engine-races/ (before runsea.run's DNS/CNAME
// is cut over -- see README's "Full data migration" section), links and
// asset paths need the /seo-engine-races/ prefix or they 404 on GitHub's
// project-pages path. PREVIEW_BASE_PATH is set only by the GitHub Actions
// workflow's preview run; once the real domain is live, delete this branch
// (and the PREVIEW_BASE_PATH env var in .github/workflows/deploy.yml)
// entirely so production goes back to using no base path.
const previewBase = process.env.PREVIEW_BASE_PATH;

export default defineConfig({
  site: previewBase ? `https://lyj898.github.io${previewBase}` : `https://${siteConfig.siteDomain}`,
  base: previewBase || undefined,
  output: 'static',
  integrations: [tailwind()],
});
