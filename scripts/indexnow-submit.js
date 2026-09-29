#!/usr/bin/env node
/**
 * indexnow-submit.js
 *
 * Tells IndexNow-participating search engines (Bing, Yandex, Seznam, Naver)
 * about every URL in the built sitemap. Bing is where runsea.run's search
 * traffic actually comes from, and it has no sitemap "ping" endpoint any
 * more -- IndexNow is its supported way to announce new and changed pages.
 *
 * Ownership is proven by a key file served at the site root:
 * public/<key>.txt, whose body is the key itself. The key is not a secret;
 * it only has to match that file.
 *
 * Posts to Bing's endpoint, which shares submissions with the other IndexNow
 * engines. (api.indexnow.org answered 403 for a freshly published key on
 * 2026-09-29 while Bing accepted it.)
 *
 * Usage: npm run build && node scripts/indexnow-submit.js
 * Reads dist/sitemap.xml, so run it after a build of what is live.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import siteConfig from '../src/lib/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const host = siteConfig.siteDomain;

const keyFile = fs.readdirSync(path.join(root, 'public')).find((f) => /^[0-9a-f]{32}\.txt$/.test(f));
if (!keyFile) {
  console.error('[indexnow] no public/<32-hex>.txt key file found -- nothing submitted.');
  process.exit(1);
}
const key = keyFile.replace(/\.txt$/, '');

const sitemap = fs.readFileSync(path.join(root, 'dist', 'sitemap.xml'), 'utf8');
const urlList = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
if (urlList.length === 0) {
  console.error('[indexnow] dist/sitemap.xml has no <loc> entries -- build first.');
  process.exit(1);
}

const res = await fetch('https://www.bing.com/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host, key, keyLocation: `https://${host}/${keyFile}`, urlList }),
});
console.log(`[indexnow] submitted ${urlList.length} URLs for ${host}: HTTP ${res.status} ${res.statusText}`);
if (!res.ok && res.status !== 202) process.exit(1);
