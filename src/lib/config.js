import siteConfig from '../../site.config.json' with { type: 'json' };

// Single import point for site.config.json across the engine. Nothing in
// /src or /scripts should `import ... from '../../site.config.json'`
// directly -- always go through this module, so there's exactly one place
// to change if the config's location ever moves.
export default siteConfig;
