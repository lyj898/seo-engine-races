// Run SEA social design kit, three looks for 1080x1350 carousel slides:
//   paper  - warm paper + lime race bib (personal / utility posts)
//   poster - lime and ink colour blocks, giant type (single shock stats)
//   glow   - dark gradient, glowing data curves, skyline (chart posts)
// Slides are SVG strings rendered to PNG with sharp; type is Segoe UI, so run
// on Windows. Post scripts build slides with these helpers.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

export const W = 1080, H = 1350;
export const INK = '#15170f', LIME = '#c8ff33', PAPER = '#f3f1e8', CREAM = '#eceee2', MUTED = '#a2a493', ORANGE = '#ff7a3d', GREY = '#77786c';
export const F = "'Segoe UI', Arial, sans-serif";
export const HV = "'Segoe UI Black', 'Arial Black', sans-serif";
export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const DEFS = `<defs>
<filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.10 0"/></filter>
<filter id="sh" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur in="SourceAlpha" stdDeviation="20"/><feOffset dy="22"/><feComponentTransfer><feFuncA type="linear" slope="0.3"/></feComponentTransfer><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="glow"><feGaussianBlur stdDeviation="10" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<linearGradient id="night" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1f2a12"/><stop offset="0.55" stop-color="#15170f"/><stop offset="1" stop-color="#0b0c08"/></linearGradient>
<linearGradient id="gl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${LIME}" stop-opacity="0.85"/><stop offset="1" stop-color="${LIME}" stop-opacity="0.04"/></linearGradient>
<linearGradient id="go" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${ORANGE}" stop-opacity="0.8"/><stop offset="1" stop-color="${ORANGE}" stop-opacity="0.04"/></linearGradient>
</defs>`;

const SKY = [[0, 60], [40, 110], [70, 80], [110, 170], [150, 90], [190, 140], [230, 70], [260, 200], [300, 120], [350, 90], [390, 150], [430, 75], [470, 230], [510, 110], [560, 140], [600, 85], [640, 180], [690, 95], [730, 130], [780, 70], [820, 160], [870, 100], [910, 120], [960, 80], [1000, 140], [1040, 90]];
export const skyline = (opacity = 0.85, scale = 0.7) => `<g fill="#000" opacity="${opacity}">${SKY.map(([x, h], i) => `<rect x="${x}" y="${H - 110 - h * scale}" width="${(SKY[i + 1]?.[0] ?? W) - x - 4}" height="${h * scale + 110}"/>`).join('')}</g>`;

/** Greedy wrap by average glyph width. */
export function wrap(str, size, maxWidth, heavy) {
  const max = Math.max(4, Math.floor(maxWidth / (size * (heavy ? 0.56 : 0.5))));
  const lines = []; let line = '';
  for (const w of String(str).split(' ')) {
    if ((line + ' ' + w).trim().length > max && line) { lines.push(line); line = w; } else line = (line + ' ' + w).trim();
  }
  if (line) lines.push(line);
  return lines;
}
/** Text block: returns { svg, h, bottom }. weight: 400|600|700|900 ('heavy' = black face). */
export function T(str, { x = 80, y, size = 40, fill = CREAM, weight = 400, maxWidth = W - 160, lh = 1.12, anchor = 'start', ls = 0, opacity = 1 }) {
  const heavy = weight === 'heavy';
  const lines = wrap(str, size, maxWidth, heavy);
  const svg = lines.map((l, i) => `<text x="${x}" y="${(y + i * size * lh).toFixed(0)}" text-anchor="${anchor}" font-family="${heavy ? HV : F}" font-weight="${heavy ? 900 : weight}" font-size="${size}" letter-spacing="${ls}" fill="${fill}" opacity="${opacity}">${esc(l)}</text>`).join('');
  const h = lines.length * size * lh;
  return { svg, h, bottom: y + h - size * lh + size * 0.3 };
}

/** Race bib: centred at (cx, cy), w x h, rotated `rot` degrees. */
export function bib({ cx, cy, w = 760, h = 480, rot = -6, top = '', big = '', bottom = '', bigSize = 220, fill = LIME, ink = INK, hole = PAPER }) {
  const bars = [3, 6, 3, 8, 3, 5, 3, 7];
  return `<g transform="translate(${cx} ${cy}) rotate(${rot})" filter="url(#sh)">
  <rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="38" fill="${fill}"/>
  ${[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => `<circle cx="${a * (w / 2 - 48)}" cy="${b * (h / 2 - 48)}" r="15" fill="${hole}"/>`).join('')}
  <text x="0" y="${-h / 2 + 100}" text-anchor="middle" font-family="${F}" font-weight="900" font-size="32" letter-spacing="7" fill="${ink}">${esc(top.toUpperCase())}</text>
  <text x="0" y="${bigSize * 0.36}" text-anchor="middle" font-family="${HV}" font-weight="900" font-size="${bigSize}" letter-spacing="-6" fill="${ink}">${esc(big)}</text>
  <line x1="${-w / 2 + 70}" x2="${w / 2 - 70}" y1="${h / 2 - 120}" y2="${h / 2 - 120}" stroke="${ink}" stroke-opacity="0.35" stroke-width="5" stroke-dasharray="14 12"/>
  <text x="${-w / 2 + 70}" y="${h / 2 - 62}" font-family="${F}" font-weight="800" font-size="28" fill="${ink}">${esc(bottom.toUpperCase())}</text>
  <g transform="translate(${w / 2 - 170} ${h / 2 - 98})">${bars.map((bw, i) => `<rect x="${bars.slice(0, i).reduce((s, v) => s + v + 5, 0)}" y="0" width="${bw}" height="42" fill="${ink}"/>`).join('')}</g>
</g>`;
}

export const pill = ({ x, y, w, h = 100, label, sub, solid = true, ink = INK, accent = LIME, size = 44 }) => `
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${solid ? ink : 'none'}" stroke="${ink}" stroke-width="5"/>
  <text x="${x + w / 2}" y="${y + h / 2 + size * 0.35}" text-anchor="middle" font-family="${HV}" font-weight="900" font-size="${size}" fill="${solid ? accent : ink}">${esc(label)}</text>
  ${sub ? `<text x="${x + w / 2}" y="${y + h + 44}" text-anchor="middle" font-family="${F}" font-weight="600" font-size="28" fill="${ink}">${esc(sub)}</text>` : ''}`;

/** Smooth area path from a density array. */
export function area(d, { x0 = 80, w = W - 160, base, h, top = Math.max(...d) }) {
  const pts = d.map((v, i) => [x0 + (w * (i + 0.5)) / d.length, base - (v / top) * h]);
  let s = `M${x0},${base} L${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const [px, py] = pts[i - 1], [x, y] = pts[i], mx = (px + x) / 2;
    s += ` C${mx.toFixed(1)},${py.toFixed(1)} ${mx.toFixed(1)},${y.toFixed(1)} ${x.toFixed(1)},${y.toFixed(1)}`;
  }
  return `${s} L${x0 + w},${base} Z`;
}
export const smooth = (d, k = 2) => d.map((_, i) => { const s = d.slice(Math.max(0, i - k), i + k + 1); return s.reduce((a, b) => a + b, 0) / s.length; });

/** Wrap a slide body in its theme's background, header and footer. */
export function slide(theme, body, { tag = '', page = 1, pages = 1, url = 'runsea.run', split = H / 2 } = {}) {
  const dark = theme !== 'paper';
  const fg = theme === 'paper' ? INK : CREAM;
  const bg = theme === 'paper' ? `<rect width="${W}" height="${H}" fill="${PAPER}"/>`
    : theme === 'poster' ? `<rect width="${W}" height="${split}" fill="${LIME}"/><rect y="${split}" width="${W}" height="${H - split}" fill="${INK}"/>`
    : theme === 'ink' ? `<rect width="${W}" height="${H}" fill="${INK}"/>`
    : `<rect width="${W}" height="${H}" fill="url(#night)"/><circle cx="900" cy="250" r="260" fill="${LIME}" opacity="0.06"/>`;
  const headFill = theme === 'poster' ? INK : theme === 'paper' ? INK : LIME;
  const footFill = theme === 'paper' ? INK : CREAM;
  const dots = pages > 1 ? Array.from({ length: pages }, (_, i) => `<circle cx="${W / 2 - (pages - 1) * 12 + i * 24}" cy="${H - 62}" r="7" fill="${i + 1 === page ? (theme === 'paper' ? INK : LIME) : dark ? '#ffffff33' : '#15170f33'}"/>`).join('') : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${DEFS}
  ${bg}
  <text x="80" y="110" font-family="${F}" font-weight="800" font-size="28" letter-spacing="6" fill="${headFill}">RUN SEA</text>
  ${tag ? `<text x="${W - 80}" y="110" text-anchor="end" font-family="${F}" font-weight="800" font-size="28" letter-spacing="5" fill="${headFill}">${esc(tag.toUpperCase())}</text>` : ''}
  ${body}
  ${dots}
  <text x="80" y="${H - 52}" font-family="${F}" font-weight="800" font-size="28" fill="${footFill}">${esc(url)}</text>
  ${pages > 1 && page < pages ? `<text x="${W - 80}" y="${H - 52}" text-anchor="end" font-family="${F}" font-weight="600" font-size="28" fill="${footFill}" opacity="0.6">swipe →</text>` : ''}
  <rect width="${W}" height="${H}" filter="url(#grain)"/>
</svg>`;
}

export async function renderPost(dir, name, slides) {
  fs.mkdirSync(dir, { recursive: true });
  const files = [];
  for (const [i, svg] of slides.entries()) {
    const file = path.join(dir, `${name}-${String(i + 1).padStart(2, '0')}.png`);
    await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(file);
    files.push(file);
  }
  return files;
}
