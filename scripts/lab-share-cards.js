#!/usr/bin/env node
/**
 * Draw the Lab's link-preview cards: one 1200x630 PNG per distance and tier,
 * written to public/og/lab/<distance>-<tier>.png, plus public/og/lab/lab.png
 * for the Lab itself. WhatsApp, Facebook and X show these when someone shares
 * a result (the share link points at /tools/rank/<distance>/<tier>/).
 *
 * The cards carry no live numbers, so they only need redrawing when the tiers
 * or the design change. Run locally and commit the PNGs:
 *
 *   node scripts/lab-share-cards.js
 *
 * Uses sharp (installed with Astro) to render SVG; text is set in Segoe UI,
 * so run it on Windows or change FONT.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { TIERS, DISTANCE_SLUG, tierBandText } from '../src/lib/labTiers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'og', 'lab');
const INK = '#15170f', LIME = '#c8ff33', TEXT = '#eceee2', MUTED = '#a2a493', DIM = '#3a3c2c';
const FONT = "'Segoe UI', Arial, sans-serif";
const HEAVY = "'Segoe UI Black', 'Arial Black', sans-serif";
const LABEL = { Half: 'HALF MARATHON', Full: 'MARATHON', '10K': '10K' };
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

// A right-skewed finish-time curve as bars (most runners bunch just after the
// fast end, then a long tail of slower times). Bars are lime from the right
// until they hold `beaten` percent of the runners -- those you finished ahead of.
function bars(beaten) {
  const N = 36, x0 = 720, w = 420, h = 230, base = 400;
  const v = Array.from({ length: N }, (_, i) => { const x = (i + 0.5) / N; return Math.pow(x, 1.6) * Math.exp(-x * 4.4); });
  const top = Math.max(...v), total = v.reduce((a, b) => a + b, 0);
  let acc = 0;
  const lime = new Array(N).fill(false);
  for (let i = N - 1; i >= 0; i--) { acc += v[i]; lime[i] = beaten > 0 && acc / total <= beaten / 100 + 0.01; }
  return v.map((y, i) => {
    const bh = Math.max(6, (y / top) * h);
    return `<rect x="${(x0 + i * (w / N)).toFixed(1)}" y="${(base - bh).toFixed(1)}" width="${(w / N - 3).toFixed(1)}" height="${bh.toFixed(1)}" rx="3" fill="${lime[i] ? LIME : DIM}"/>`;
  }).join('');
}

function ladder(cur) {
  const w = 172, gap = 10, x0 = 60, y = 470;
  return TIERS.map((t, i) => {
    const x = x0 + i * (w + gap);
    const fill = i === cur ? LIME : 'none';
    const stroke = i === cur ? LIME : i < cur ? `${LIME}88` : '#ffffff22';
    const color = i === cur ? INK : i < cur ? LIME : '#6d6f5f';
    return `<rect x="${x}" y="${y}" width="${w}" height="62" rx="12" fill="${fill}" stroke="${stroke}" stroke-width="2"/>
      <text x="${x + w / 2}" y="${y + 30}" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="20" letter-spacing="1.5" fill="${color}">${t.name.toUpperCase()}</text>
      <text x="${x + w / 2}" y="${y + 51}" text-anchor="middle" font-family="${FONT}" font-size="15" fill="${color}" opacity="0.8">${t.p ? `top ${100 - t.p}%` : 'everyone'}</text>`;
  }).join('');
}

function card({ dist, tierIndex }) {
  const t = tierIndex == null ? null : TIERS[tierIndex];
  const band = t && tierBandText(tierIndex).replace(/^the top/, 'Top');
  const footer = (left) => `<line x1="60" x2="1140" y1="568" y2="568" stroke="#ffffff22" stroke-width="2"/>
  <text x="60" y="604" font-family="${FONT}" font-size="24" fill="${MUTED}">${esc(left)}</text>
  <text x="1140" y="604" text-anchor="end" font-family="${FONT}" font-weight="700" font-size="24" fill="${TEXT}">runsea.run/tools</text>`;
  const top = `<rect width="1200" height="630" fill="${INK}"/>
  <text x="60" y="86" font-family="${FONT}" font-weight="700" font-size="24" letter-spacing="4" fill="${TEXT}">RUN SEA LAB</text>`;
  if (!t) {
    // The Lab's own card: the question, the scale, the distances.
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">${top}
  <text x="60" y="230" font-family="${HEAVY}" font-weight="900" font-size="100" fill="${TEXT}">How do you</text>
  <text x="60" y="340" font-family="${HEAVY}" font-weight="900" font-size="100" fill="${LIME}">stack up?</text>
  <text x="60" y="420" font-family="${FONT}" font-weight="600" font-size="34" fill="${TEXT}">Your race time against 200,000+ finishes</text>
  <text x="60" y="464" font-family="${FONT}" font-size="30" fill="${MUTED}">across Southeast Asia, by gender and age</text>
  ${bars(60)}
  ${footer('Half marathon · Marathon · 10K')}
</svg>`;
  }
  const sub = t.p ? `${band} of runners` : 'Crossed the finish line';
  const sub2 = t.p ? 'of the same gender and age in Southeast Asia' : 'Every finish counts. How fast was yours?';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">${top}
  <text x="1140" y="86" text-anchor="end" font-family="${FONT}" font-weight="700" font-size="24" letter-spacing="4" fill="${LIME}">${LABEL[dist]}</text>
  <text x="60" y="250" font-family="${HEAVY}" font-weight="900" font-size="104" fill="${LIME}">${esc(t.name)}</text>
  <text x="60" y="318" font-family="${FONT}" font-weight="600" font-size="34" fill="${TEXT}">${esc(sub)}</text>
  <text x="60" y="362" font-family="${FONT}" font-size="30" fill="${MUTED}">${esc(sub2)}</text>
  ${bars(t.p)}
  ${ladder(tierIndex)}
  ${footer('How do you stack up? See where your time ranks')}
</svg>`;
}

fs.mkdirSync(OUT, { recursive: true });
const jobs = [{ file: 'lab.png', svg: card({}) }];
for (const dist of Object.keys(DISTANCE_SLUG)) {
  TIERS.forEach((t, i) => jobs.push({ file: `${DISTANCE_SLUG[dist]}-${t.slug}.png`, svg: card({ dist, tierIndex: i }) }));
}
for (const j of jobs) await sharp(Buffer.from(j.svg)).png({ compressionLevel: 9 }).toFile(path.join(OUT, j.file));
console.log(`wrote ${jobs.length} cards to ${path.relative(ROOT, OUT)}`);
