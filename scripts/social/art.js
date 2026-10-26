// Illustrations for social slides: the homepage's Southeast Asia map (land
// paths read from src/components/HeroMap.astro, same projection) with race
// pins, Olympic-style runner pictograms, and a small icon set. All return SVG
// fragments for the kit's slide() bodies.
import fs from 'node:fs';
import { LIME, INK, CREAM, ORANGE, PAPER, F, HV, esc } from './kit.js';

const hero = fs.readFileSync(new URL('../../src/components/HeroMap.astro', import.meta.url), 'utf8');
const LAND = [...hero.slice(hero.indexOf('const land'), hero.indexOf('];')).matchAll(/'(M[^']+)'/g)].map((m) => m[1]);
// HeroMap's projection: a 640 x 560 box.
const proj = (lon, lat) => [(lon - 92) * 17.78, (22 - lat) * 17.5];

// Where races are, for pins. Matched against "<city> <name> <country>".
const PLACES = [
  [/Bulacan|Malolos/i, 120.81, 14.84, 'Bulacan'], [/Ubon/i, 104.86, 15.24, 'Ubon'], [/Kota Kinabalu|Likas/i, 116.07, 5.98, 'Kota Kinabalu'], [/Davao/i, 125.61, 7.07, 'Davao'],
  [/Hanoi|Ha Noi/i, 105.85, 21.03, 'Hanoi'], [/Kuching/i, 110.34, 1.55, 'Kuching'], [/Pontianak/i, 109.33, -0.03, 'Pontianak'], [/Rayong/i, 101.28, 12.68, 'Rayong'],
  [/Pattaya/i, 100.88, 12.93, 'Pattaya'], [/Bangsaen|Chon ?Buri/i, 100.91, 13.28, 'Bangsaen'], [/Surabaya/i, 112.75, -7.25, 'Surabaya'], [/Sandakan|Elopura/i, 118.06, 5.84, 'Sandakan'],
  [/Khon Kaen/i, 102.84, 16.43, 'Khon Kaen'], [/Ha ?Long|Halong/i, 107.08, 20.95, 'Ha Long'], [/Hai Phong|Hải Phòng/i, 106.68, 20.86, 'Hai Phong'], [/Magelang|Borobudur/i, 110.2, -7.61, 'Borobudur'],
  [/Bagan|Nyaung/i, 94.86, 21.17, 'Bagan'], [/Siem Reap|Angkor/i, 103.86, 13.36, 'Angkor'], [/Penang|Batu Kawan/i, 100.33, 5.41, 'Penang'], [/Toba|Parapat/i, 98.93, 2.66, 'Lake Toba'],
  [/Langkawi/i, 99.8, 6.35, 'Langkawi'], [/Phuket|Kathu|Bang Thao/i, 98.33, 7.95, 'Phuket'], [/Sanur|Bali/i, 115.26, -8.7, 'Bali'], [/Da ?Nang/i, 108.22, 16.05, 'Da Nang'],
  [/Boracay|Aklan/i, 121.92, 11.97, 'Boracay'], [/Cebu/i, 123.89, 10.32, 'Cebu'], [/Singapore/i, 103.82, 1.35, 'Singapore'], [/Johor|Tebrau/i, 103.76, 1.49, 'Johor Bahru'],
  [/Putrajaya/i, 101.69, 2.93, 'Putrajaya'], [/Petaling|Selangor|Puchong/i, 101.61, 3.07, 'Selangor'], [/Nilai/i, 101.8, 2.82, 'Nilai'], [/Mersing/i, 103.84, 2.43, 'Mersing'],
  [/Kuala Lumpur|Setiawangsa/i, 101.69, 3.14, 'Kuala Lumpur'], [/Ho Chi Minh|Saigon/i, 106.7, 10.78, 'Ho Chi Minh City'], [/Nakhon Nayok|Khun Dan/i, 101.2, 14.3, 'Nakhon Nayok'],
  [/Bangkok/i, 100.5, 13.75, 'Bangkok'], [/Manila|Makati|Taguig|Pasay/i, 120.98, 14.6, 'Manila'], [/Jakarta/i, 106.85, -6.2, 'Jakarta'], [/Chiang Mai/i, 98.99, 18.79, 'Chiang Mai'],
];
export function placeOf(e) {
  const s = `${e.core_facts?.city ?? ''} ${e.name ?? ''} ${e.core_facts?.country ?? ''}`;
  const hit = PLACES.find(([re]) => re.test(s));
  return hit ? { lon: hit[1], lat: hit[2], name: hit[3] } : null;
}

/** Map of SEA at (x, y) scaled by s; pins stay a fixed size at any zoom.
 *  pins: [{lon, lat, color, label, side}]. Labels that would collide with an
 *  earlier one try the other side, then below, then are dropped (the pin stays). */
export function seaMap({ x = 0, y = 0, s = 1.6, land = '#3a4128', stroke = '#5c653a', pins = [], labelFill = CREAM, halo = INK, labelSize = 28, clip = null }) {
  const boxes = [];
  const free = (b) => !boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]) && b[0] > 20 && b[2] < 1060;
  const dots = [], labels = [];
  for (const p of pins) {
    const [px, py] = proj(p.lon, p.lat);
    const X = x + px * s, Y = y + py * s;
    dots.push(`<circle cx="${X}" cy="${Y}" r="24" fill="${p.color}" opacity="0.28"/><circle cx="${X}" cy="${Y}" r="12" fill="${p.color}" stroke="${INK}" stroke-width="3"/>`);
    boxes.push([X - 14, Y - 14, X + 14, Y + 14]);
  }
  for (const p of pins) {
    if (!p.label) continue;
    const [px, py] = proj(p.lon, p.lat);
    const X = x + px * s, Y = y + py * s;
    const w = p.label.length * labelSize * 0.56, h = labelSize;
    const pref = p.side ?? (X > 640 ? 'left' : 'right');
    const tries = [pref, pref === 'left' ? 'right' : 'left', 'below', 'above'];
    for (const side of tries) {
      const box = side === 'left' ? [X - 24 - w, Y - h / 2, X - 24, Y + h / 2] : side === 'right' ? [X + 24, Y - h / 2, X + 24 + w, Y + h / 2]
        : side === 'below' ? [X - w / 2, Y + 26, X + w / 2, Y + 26 + h] : [X - w / 2, Y - 26 - h, X + w / 2, Y - 26];
      if (!free(box)) continue;
      boxes.push(box);
      const anchor = side === 'left' ? 'end' : side === 'right' ? 'start' : 'middle';
      const tx = side === 'left' ? X - 24 : side === 'right' ? X + 24 : X;
      const ty = side === 'below' ? Y + 26 + h * 0.8 : side === 'above' ? Y - 26 - h * 0.2 : Y + h * 0.35;
      labels.push(`<text x="${tx}" y="${ty}" text-anchor="${anchor}" font-family="${F}" font-weight="800" font-size="${labelSize}" fill="${labelFill}" paint-order="stroke" stroke="${halo}" stroke-width="7" stroke-linejoin="round">${esc(p.label)}</text>`);
      break;
    }
  }
  const clipDef = clip ? `<clipPath id="mapclip"><rect x="${clip[0]}" y="${clip[1]}" width="${clip[2]}" height="${clip[3]}" rx="28"/></clipPath>` : '';
  return `${clipDef}<g ${clip ? 'clip-path="url(#mapclip)"' : ''}><g transform="translate(${x} ${y}) scale(${s})"><g fill="${land}" stroke="${stroke}" stroke-width="${(1.4 / Math.max(1, s / 1.6)).toFixed(2)}" stroke-linejoin="round">${LAND.map((d) => `<path d="${d}"/>`).join('')}</g></g></g>${dots.join('')}${labels.join('')}`;
}
/** Screen position of a lon/lat on a map drawn at (x, y, s). */
export const at = (lon, lat, { x = 0, y = 0, s = 1.6 }) => { const [px, py] = proj(lon, lat); return [x + px * s, y + py * s]; };

/** Running pictogram facing right, feet at (x, y), height ~ 130*s. */
export function runner({ x, y, s = 1, color = INK, ponytail = false, stoop = 0 }) {
  const w = 13;
  const L = (pts) => `<polyline points="${pts.map(([a, b]) => `${a},${b}`).join(' ')}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
  return `<g transform="translate(${x} ${y}) scale(${s})">
    <circle cx="${14 + stoop}" cy="-112" r="13" fill="${color}"/>
    ${ponytail ? `<path d="M${4 + stoop} -118 q -16 2 -22 14" fill="none" stroke="${color}" stroke-width="8" stroke-linecap="round"/>` : ''}
    ${L([[8 + stoop, -92], [-4, -46]])}
    ${L([[6 + stoop, -86], [28, -66], [42, -80]])}
    ${L([[6 + stoop, -86], [-16, -70], [-30, -86]])}
    ${L([[-4, -46], [22, -26], [16, 4]])}
    ${L([[-4, -46], [-22, -20], [-48, -28]])}
  </g>`;
}

export const stopwatch = ({ x, y, r = 120, color = LIME, face = INK, angle = 0, label = '' }) => `
  <g transform="translate(${x} ${y})" filter="url(#glow)">
    <rect x="${-r * 0.16}" y="${-r - r * 0.32}" width="${r * 0.32}" height="${r * 0.2}" rx="${r * 0.05}" fill="${color}"/>
    <rect x="${-r * 0.07}" y="${-r - r * 0.14}" width="${r * 0.14}" height="${r * 0.18}" fill="${color}"/>
    <circle r="${r}" fill="${face}" stroke="${color}" stroke-width="${r * 0.12}"/>
    ${Array.from({ length: 12 }, (_, i) => { const a = (i * Math.PI) / 6; return `<line x1="${Math.sin(a) * r * 0.72}" y1="${-Math.cos(a) * r * 0.72}" x2="${Math.sin(a) * r * 0.84}" y2="${-Math.cos(a) * r * 0.84}" stroke="${color}" stroke-width="${i % 3 ? 3 : 7}" stroke-linecap="round"/>`; }).join('')}
    <line x1="0" y1="0" x2="${Math.sin((angle * Math.PI) / 180) * r * 0.66}" y2="${-Math.cos((angle * Math.PI) / 180) * r * 0.66}" stroke="${color}" stroke-width="${r * 0.07}" stroke-linecap="round"/>
    <circle r="${r * 0.08}" fill="${color}"/>
    ${label ? `<text y="${r * 0.42}" text-anchor="middle" font-family="${HV}" font-weight="900" font-size="${r * 0.3}" fill="${color}">${esc(label)}</text>` : ''}
  </g>`;

export const stars = (pts, color = CREAM) => pts.map(([x, y, r]) => `<path d="M${x} ${y - r} L${x + r * 0.28} ${y - r * 0.28} L${x + r} ${y} L${x + r * 0.28} ${y + r * 0.28} L${x} ${y + r} L${x - r * 0.28} ${y + r * 0.28} L${x - r} ${y} L${x - r * 0.28} ${y - r * 0.28} Z" fill="${color}" opacity="0.85"/>`).join('');

export const moon = ({ x, y, r = 140, bg = '#1b2210' }) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${CREAM}" opacity="0.95" filter="url(#glow)"/><circle cx="${x + r * 0.42}" cy="${y - r * 0.28}" r="${r}" fill="${bg}"/>`;

export const thermometer = ({ x, y, h = 420, level = 0.8, color = ORANGE }) => `
  <g transform="translate(${x} ${y})" filter="url(#glow)">
    <rect x="-34" y="${-h}" width="68" height="${h}" rx="34" fill="#ffffff14" stroke="${CREAM}" stroke-opacity="0.5" stroke-width="5"/>
    <rect x="-18" y="${-h * level}" width="36" height="${h * level}" rx="18" fill="${color}"/>
    <circle cy="30" r="64" fill="${color}"/>
  </g>`;

export const hourglass = ({ x, y, s = 1, color = INK, sand = LIME }) => `
  <g transform="translate(${x} ${y}) scale(${s})">
    <rect x="-120" y="-200" width="240" height="26" rx="12" fill="${color}"/><rect x="-120" y="174" width="240" height="26" rx="12" fill="${color}"/>
    <path d="M-95 -174 L95 -174 L12 0 L95 174 L-95 174 L-12 0 Z" fill="#ffffff" stroke="${color}" stroke-width="12" stroke-linejoin="round"/>
    <path d="M-50 -80 L50 -80 L8 0 L-8 0 Z" fill="${sand}"/><path d="M-80 162 L80 162 L0 70 Z" fill="${sand}"/>
    <line x1="0" y1="0" x2="0" y2="80" stroke="${sand}" stroke-width="6"/>
  </g>`;

// Landmarks, line-drawn, ~260 wide, base at (x, y).
export const stupa = ({ x, y, color = INK, s = 1 }) => `<g transform="translate(${x} ${y}) scale(${s})" fill="${color}">
  <rect x="-130" y="-40" width="260" height="40" rx="6"/><rect x="-105" y="-75" width="210" height="35" rx="6"/><rect x="-80" y="-105" width="160" height="30" rx="6"/>
  <path d="M-62 -105 Q -62 -190 0 -200 Q 62 -190 62 -105 Z"/><rect x="-8" y="-262" width="16" height="64" rx="6"/><circle cy="-270" r="12"/></g>`;
export const bridge = ({ x, y, color = INK, s = 1 }) => `<g transform="translate(${x} ${y}) scale(${s})" stroke="${color}" stroke-linecap="round" fill="none">
  <line x1="-170" y1="-40" x2="170" y2="-40" stroke-width="14"/>
  ${[-70, 70].map((px) => `<line x1="${px}" y1="0" x2="${px}" y2="-210" stroke-width="16"/>${[-120, -90, -60, -30].map((d) => `<line x1="${px}" y1="-200" x2="${px + d}" y2="-40" stroke-width="4"/><line x1="${px}" y1="-200" x2="${px - d}" y2="-40" stroke-width="4"/>`).join('')}`).join('')}
  <path d="M-180 10 Q -135 -6 -90 10 T 0 10 T 90 10 T 180 10" stroke-width="6" opacity="0.5"/></g>`;
export const volcano = ({ x, y, color = INK, lake = LIME, s = 1 }) => `<g transform="translate(${x} ${y}) scale(${s})">
  <path d="M-160 0 L-50 -190 L50 -190 L160 0 Z" fill="${color}"/><ellipse cx="0" cy="-190" rx="50" ry="12" fill="${lake}"/>
  <path d="M-20 -215 q 10 -25 0 -50 M20 -215 q 14 -25 4 -55" stroke="${color}" stroke-width="8" fill="none" stroke-linecap="round" opacity="0.5"/></g>`;
export const palm = ({ x, y, color = INK, s = 1 }) => `<g transform="translate(${x} ${y}) scale(${s})" fill="none" stroke="${color}" stroke-linecap="round">
  <path d="M0 0 Q 18 -120 -10 -250" stroke-width="18"/>
  ${[[-120, -230], [-100, -300], [20, -320], [110, -280], [120, -210]].map(([a, b]) => `<path d="M-10 -250 Q ${(a - 10) / 2} ${b - 40} ${a} ${b}" stroke-width="14"/>`).join('')}</g>`;
export const waves = ({ x, y, w = 920, color = INK, n = 4 }) => Array.from({ length: n }, (_, i) => `<path d="M${x} ${y + i * 36} q ${w / 8} -26 ${w / 4} 0 t ${w / 4} 0 t ${w / 4} 0 t ${w / 4} 0" stroke="${color}" stroke-width="10" fill="none" stroke-linecap="round" opacity="${0.9 - i * 0.2}"/>`).join('');
export const hazeSun = ({ x, y, r = 170 }) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${ORANGE}" opacity="0.9" filter="url(#glow)"/>
  ${Array.from({ length: 6 }, (_, i) => `<rect x="${x - r * 1.6}" y="${y - r + i * (r / 3) + 10}" width="${r * 3.2}" height="${r / 6}" rx="${r / 12}" fill="#9a8f78" opacity="${0.35 + i * 0.07}"/>`).join('')}`;
