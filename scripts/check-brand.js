#!/usr/bin/env node
/**
 * check-brand.js
 *
 * Fails the build if the site's logo drifts from the brand standard.
 *
 * The standard is the Instagram profile logo (Alex, Nov 2026: "ig one should
 * be the standard... make sure it stays consistent everywhere and all the
 * time"): a lime #c8ff33 disc with a near-black #15170f pulse line, the same
 * in light and dark mode. The site once drifted to an inverted mark (dark disc,
 * lime line, plus a dot) whose disc followed the text colour and turned pale
 * at night; this check stops that happening again.
 *
 * Runs as part of `npm run validate`, so CI blocks a deploy that breaks it.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const LIME = '#c8ff33';
const INK = '#15170f';
const PATH_D = 'M8.4 20.9 L13.4 12.6 L18 17.2 L23.7 8.7';

const problems = [];
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

for (const rel of ['src/components/Logo.astro', 'public/favicon.svg']) {
  const s = read(rel).toLowerCase();
  if (!s.includes(`fill="${LIME}"`)) problems.push(`${rel}: the disc must be filled ${LIME}`);
  if (!s.includes(`stroke="${INK}"`)) problems.push(`${rel}: the pulse line must be ${INK}`);
  if (!s.includes(PATH_D.toLowerCase())) problems.push(`${rel}: the pulse line shape changed (expected d="${PATH_D}")`);
  if (/currentcolor/.test(s)) problems.push(`${rel}: uses currentColor, so the logo would change with the theme`);
  if ((s.match(/<circle/g) || []).length !== 1) problems.push(`${rel}: expected exactly one circle (no extra dot)`);
}
for (const rel of ['public/apple-touch-icon.png', 'public/favicon-48.png']) {
  if (!fs.existsSync(path.join(ROOT, rel))) problems.push(`${rel} is missing (make it from runsea-social/brand/profile.png)`);
}

if (problems.length) {
  console.error('Brand check failed: the logo must match the Instagram profile logo.');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log('Brand check: logo and icons match the Instagram mark.');
