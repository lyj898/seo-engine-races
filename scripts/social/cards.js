// Drawing kit for Run SEA social posts: 1080x1350 carousel slides (Instagram
// portrait; also TikTok photo mode) in the share card's ink-and-lime look.
// Each slide is an SVG string rendered to PNG with sharp. Text is set in
// Segoe UI, so run on Windows. Week scripts (scripts/social/week-*.js) build
// their slides with these helpers and write PNGs outside the repo.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

export const W = 1080, H = 1350;
export const INK = '#15170f', LIME = '#c8ff33', TEXT = '#eceee2', MUTED = '#a2a493', DIM = '#3a3c2c', LINE = '#ffffff22';
export const FONT = "'Segoe UI', Arial, sans-serif";
export const HEAVY = "'Segoe UI Black', 'Arial Black', sans-serif";
export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Greedy word wrap by an average character width (good enough for Segoe UI). */
export function wrap(text, size, maxWidth, weight = 'normal') {
  const per = size * (weight === 'heavy' ? 0.62 : 0.52);
  const max = Math.max(4, Math.floor(maxWidth / per));
  const lines = [];
  let line = '';
  for (const w of String(text).split(' ')) {
    if ((line + ' ' + w).trim().length > max && line) { lines.push(line); line = w; } else line = (line + ' ' + w).trim();
  }
  if (line) lines.push(line);
  return lines;
}

/** Multi-line text block; returns { svg, height }. */
export function text(str, { x = 80, y, size = 40, color = TEXT, weight = 'normal', maxWidth = W - 160, lineHeight = 1.18, anchor = 'start' }) {
  const lines = wrap(str, size, maxWidth, weight);
  const family = weight === 'heavy' ? HEAVY : FONT;
  const fw = weight === 'heavy' ? 900 : weight === 'bold' ? 700 : weight === 'semibold' ? 600 : 400;
  const svg = lines.map((l, i) => `<text x="${x}" y="${(y + i * size * lineHeight).toFixed(0)}" text-anchor="${anchor}" font-family="${family}" font-weight="${fw}" font-size="${size}" fill="${color}">${esc(l)}</text>`).join('');
  return { svg, height: lines.length * size * lineHeight };
}

/** Frame every slide shares: brand top-left, a tag top-right, page dots and URL at the foot. */
export function frame(body, { tag = '', page = 1, pages = 1, url = 'runsea.run' } = {}) {
  const dots = Array.from({ length: pages }, (_, i) => `<circle cx="${W / 2 - (pages - 1) * 11 + i * 22}" cy="${H - 70}" r="6" fill="${i + 1 === page ? LIME : '#ffffff33'}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${INK}"/>
  <text x="80" y="110" font-family="${FONT}" font-weight="700" font-size="28" letter-spacing="5" fill="${TEXT}">RUN SEA</text>
  ${tag ? `<text x="${W - 80}" y="110" text-anchor="end" font-family="${FONT}" font-weight="700" font-size="28" letter-spacing="4" fill="${LIME}">${esc(tag.toUpperCase())}</text>` : ''}
  ${body}
  <line x1="80" x2="${W - 80}" y1="${H - 120}" y2="${H - 120}" stroke="${LINE}" stroke-width="2"/>
  ${pages > 1 ? dots : ''}
  <text x="80" y="${H - 60}" font-family="${FONT}" font-weight="700" font-size="28" fill="${TEXT}">${esc(url)}</text>
  ${pages > 1 && page < pages ? `<text x="${W - 80}" y="${H - 60}" text-anchor="end" font-family="${FONT}" font-size="28" fill="${MUTED}">swipe →</text>` : ''}
</svg>`;
}

/** Right-skewed finish-time curve; bars lime from the left up to `fastShare` of runners (the fast end). */
export function curve({ x, y, w, h, bins, limeIf }) {
  const top = Math.max(...bins.map((b) => b.n));
  const bw = w / bins.length;
  return bins.map((b, i) => {
    const bh = Math.max(4, (b.n / top) * h);
    return `<rect x="${(x + i * bw).toFixed(1)}" y="${(y + h - bh).toFixed(1)}" width="${(bw - 4).toFixed(1)}" height="${bh.toFixed(1)}" rx="4" fill="${limeIf(b) ? LIME : DIM}"/>`;
  }).join('');
}

export async function render(slides, outDir, prefix) {
  fs.mkdirSync(outDir, { recursive: true });
  const files = [];
  for (const [i, svg] of slides.entries()) {
    const file = path.join(outDir, `${prefix}-${String(i + 1).padStart(2, '0')}.png`);
    await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(file);
    files.push(file);
  }
  return files;
}
