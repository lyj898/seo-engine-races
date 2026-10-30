// "<Race> in numbers": a four-slide recap of one race's finish times, made
// for the days after it when its runners go looking for it. Built from
// data/finish-times/<slug>.json (times, gender and age band only -- no names,
// and no winners' times), compared with the Lab's region-wide figures.
//
//   node scripts/social/race-recap.js <folder-name> <slug> [<slug> ...]
//
// Writes slides and captions.md to OneDrive/Documents/runsea-social/<folder-name>/;
// turn them into Reels with scripts/social/reels.js.
import fs from 'node:fs';
import path from 'node:path';
import { loadEntities, stripMeta } from '../../src/lib/data.js';
import { loadFinishTimes, DISTANCE_LABEL } from '../../src/lib/finishTimes.js';
import { W, H, INK, LIME, CREAM, MUTED, F, HV, esc, T, pill, area, smooth, skyline, slide, renderPost } from './kit.js';

const [folder, ...slugs] = process.argv.slice(2);
if (!folder || !slugs.length) { console.error('usage: node scripts/social/race-recap.js <folder-name> <slug> [...]'); process.exit(1); }
const ROOT = path.join(process.env.USERPROFILE ?? '.', 'OneDrive', 'Documents', 'runsea-social', folder);

// Display names and hashtags, where the record's name is too long for a slide.
const SHORT = {
  'hoka-midnight-run-asia-2026-iloilo': { name: 'HOKA Midnight Run Iloilo', tags: '#HOKAMidnightRun #iloilo #runnersph' },
  'gemadept-run-hcmc-2026': { name: 'Gemadept Run HCMC', tags: '#GemadeptRun #hochiminhcity #vietnamrunners' },
  'vpbank-hanoi-international-marathon-2026': { name: 'VPBank Hanoi Marathon', tags: '#VPBankHanoiMarathon #hanoi #vietnamrunners' },
};
const MILESTONE = { Full: 4 * 3600, Half: 2 * 3600, '10K': 3600 };
const MILE_LABEL = { Full: 'four hours', Half: 'two hours', '10K': 'one hour' };
const NOUN = { Full: 'marathon', Half: 'half', '10K': '10K' };

const hm = (s) => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h}:${String(m).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`; };
const q = (a, p) => a[Math.round(p * (a.length - 1))];
const pct = (x) => `${Math.round(x * 100)}%`;
const n = (x) => x.toLocaleString('en-US');
const day = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const BANDS = ['20-29', '30-39', '40-49', '50-59', '60+'];
const bandWords = (b) => (b === '60+' ? 'their 60s and up' : `their ${b.slice(0, 2)}s`);

const ft = loadFinishTimes();
const entities = new Map(loadEntities().map(stripMeta).map((e) => [e.slug, e]));
const posts = [];

for (const slug of slugs) {
  const rec = JSON.parse(fs.readFileSync(path.join('data', 'finish-times', `${slug}.json`), 'utf8'));
  const e = entities.get(slug);
  const short = SHORT[slug]?.name ?? e.name.replace(/\s+20\d\d\b/, '');
  const D = rec.distances;
  // Main distance: the marathon if it drew a real field, else the half, else the 10K.
  const main = ['Full', 'Half', '10K'].find((k) => D[k]?.times.length >= (k === 'Full' ? 500 : 300)) ?? Object.keys(D)[0];
  const times = D[main].times.map(([t]) => t).sort((a, b) => a - b);
  const mile = MILESTONE[main];
  const share = times.filter((t) => t < mile).length / times.length;
  const region = ft.insights[main];
  const median = q(times, 0.5), top10 = q(times, 0.1);

  // Age story: the band that most clearly out-ran runners in their 20s, at any
  // distance with age groups (25+ finishers per band).
  let age = null;
  for (const k of Object.keys(D)) {
    for (const g of ['M', 'F']) {
      const med = {};
      for (const b of BANDS) {
        const v = D[k].times.filter(([, gg, a]) => gg === g && a === b).map(([t]) => t).sort((x, y) => x - y);
        if (v.length >= 25) med[b] = q(v, 0.5);
      }
      if (!med['20-29']) continue;
      for (const b of BANDS.slice(1)) {
        if (med[b] && med['20-29'] - med[b] > 60 && (!age || med['20-29'] - med[b] > age.gap)) age = { k, g, b, gap: med['20-29'] - med[b] };
      }
    }
  }

  const P = 4, tag = short;
  const oneIn = Math.max(2, Math.round(1 / share));
  const s1 = slide('poster', `
    ${T(`${short} ${e.core_facts.date.slice(0, 4)}`.toUpperCase(), { y: 200, size: 36, weight: 800, fill: INK, ls: 3, maxWidth: 920 }).svg}
    <text x="70" y="560" font-family="${HV}" font-weight="900" font-size="300" letter-spacing="-10" fill="${INK}">1 in ${oneIn}</text>
    ${T(`broke ${MILE_LABEL[main]} in the ${NOUN[main]}`, { y: 820, size: 66, weight: 'heavy', fill: LIME, maxWidth: 920 }).svg}
    ${T(`${pct(share)} here. Across Southeast Asia: ${pct(region.underMilestone)}.`, { y: 1000, size: 40, fill: CREAM }).svg}
    ${T(`${n(times.length)} ${NOUN[main]} finishers, ${day(e.core_facts.date)}.`, { y: 1070, size: 34, fill: MUTED }).svg}`, { tag: 'Race recap', page: 1, pages: P, split: 700 });

  // Finish-time spread, lime under the milestone.
  const lo = q(times, 0.01), hi = q(times, 0.97), N = 40, base = 1000, ch = 400;
  const bins = Array(N).fill(0);
  for (const t of times) if (t >= lo && t <= hi) bins[Math.min(N - 1, Math.floor(((t - lo) / (hi - lo)) * N))]++;
  const d = smooth(bins, 1);
  const xAt = (t) => 80 + ((t - lo) / (hi - lo)) * (W - 160);
  const xm = xAt(mile), xmed = xAt(median);
  const h2 = T(`How ${short} finished`, { y: 250, size: 68, weight: 'heavy', maxWidth: 920 });
  const s2 = slide('glow', `${h2.svg}
    ${T(`${DISTANCE_LABEL[main]}. Lime: under ${hm(mile)}.`, { y: h2.bottom + 60, size: 38, fill: MUTED }).svg}
    <clipPath id="under"><rect x="0" y="0" width="${Math.max(80, xm)}" height="${H}"/></clipPath>
    <path d="${area(d, { base, h: ch })}" fill="#ffffff" fill-opacity="0.12"/>
    <path d="${area(d, { base, h: ch })}" fill="url(#gl)" clip-path="url(#under)" filter="url(#glow)"/>
    ${mile > lo && mile < hi ? `<line x1="${xm}" x2="${xm}" y1="560" y2="${base}" stroke="#fff" stroke-width="4" stroke-dasharray="10 10"/>
    <rect x="${xm - 70}" y="520" width="140" height="56" rx="28" fill="#fff"/><text x="${xm}" y="559" text-anchor="middle" font-family="${HV}" font-weight="900" font-size="34" fill="${INK}">${hm(mile)}</text>` : ''}
    <line x1="${xmed}" x2="${xmed}" y1="640" y2="${base}" stroke="${LIME}" stroke-width="4"/>
    <text x="${Math.min(W - 90, xmed + 14)}" y="660" text-anchor="${xmed > W - 300 ? 'end' : 'start'}" font-family="${F}" font-weight="700" font-size="30" fill="${LIME}">typical ${hm(median)}</text>
    <text x="80" y="${base + 50}" font-family="${F}" font-size="30" fill="${MUTED}">${hm(lo)}</text><text x="${W - 80}" y="${base + 50}" text-anchor="end" font-family="${F}" font-size="30" fill="${MUTED}">${hm(hi)}</text>
    ${T(`Top 10% ran under ${hm(top10)}.`, { y: 1160, size: 40, fill: CREAM }).svg}`, { tag, page: 2, pages: P });

  // Third slide: the age story if there is one, else men vs women.
  // hi: highlight both cells (true) or just one gender's ('M' / 'F').
  const row = (y, label, m, w, hi) => `<text x="80" y="${y}" font-family="${F}" font-weight="700" font-size="46" fill="${CREAM}">${esc(label)}</text><text x="640" y="${y}" text-anchor="middle" font-family="${HV}" font-weight="900" font-size="64" fill="${hi === true || hi === 'M' ? LIME : CREAM}">${m}</text><text x="900" y="${y}" text-anchor="middle" font-family="${HV}" font-weight="900" font-size="64" fill="${hi === true || hi === 'F' ? LIME : CREAM}">${w}</text>`;
  const heads = `<text x="640" y="470" text-anchor="middle" font-family="${F}" font-weight="800" font-size="30" letter-spacing="4" fill="${MUTED}">MEN</text><text x="900" y="470" text-anchor="middle" font-family="${F}" font-weight="800" font-size="30" letter-spacing="4" fill="${MUTED}">WOMEN</text>`;
  let s3, ageLine;
  if (age) {
    const who = age.g === 'M' ? 'Men' : 'Women';
    const medOf = (g, b) => { const v = D[age.k].times.filter(([, gg, a]) => gg === g && a === b).map(([t]) => t).sort((x, y) => x - y); return v.length >= 25 ? hm(q(v, 0.5)) : '–'; };
    const shown = BANDS.filter((b) => medOf('M', b) !== '–' || medOf('F', b) !== '–');
    const h3 = T(`${who} in ${bandWords(age.b)} ran the ${NOUN[age.k]} faster than ${who.toLowerCase()} in their 20s`, { y: 230, size: 58, weight: 'heavy', maxWidth: 920 });
    s3 = slide('glow', `${h3.svg}
      ${T(`Typical ${DISTANCE_LABEL[age.k].toLowerCase()} finish by age.`, { y: h3.bottom + 50, size: 36, fill: MUTED }).svg}
      <g transform="translate(0 ${h3.bottom + 40 - 380})">${heads}</g>
      ${shown.map((b, i) => row(h3.bottom + 210 + i * 125, b === '60+' ? '60+' : b, medOf('M', b), medOf('F', b), (b === age.b || b === '20-29') && age.g)).join('')}`, { tag, page: 3, pages: P });
    ageLine = `${who} in ${bandWords(age.b)} ran the ${NOUN[age.k]} faster than ${who.toLowerCase()} in their 20s: ${medOf(age.g, age.b)} against ${medOf(age.g, '20-29')}.`;
  } else {
    const by = (g) => D[main].times.filter(([, gg]) => gg === g).map(([t]) => t).sort((x, y) => x - y);
    const M = by('M'), Fm = by('F');
    const h3 = T(`${short}: men and women`, { y: 250, size: 68, weight: 'heavy', maxWidth: 920 });
    s3 = slide('glow', `${h3.svg}
      ${T(DISTANCE_LABEL[main] + '.', { y: h3.bottom + 50, size: 36, fill: MUTED }).svg}<g transform="translate(0 ${Math.max(0, h3.bottom - 290)})">${heads}</g>
      ${row(620, 'Top 10%', hm(q(M, 0.1)), hm(q(Fm, 0.1)), true)}${row(780, 'Typical', hm(q(M, 0.5)), hm(q(Fm, 0.5)))}${row(940, 'Under ' + hm(mile), pct(M.filter((t) => t < mile).length / M.length), pct(Fm.filter((t) => t < mile).length / Fm.length))}`, { tag, page: 3, pages: P });
    ageLine = `Typical finish: ${hm(q(M, 0.5))} for men, ${hm(q(Fm, 0.5))} for women.`;
  }

  const h4 = T(`Ran ${short}?`, { y: 330, size: 92, weight: 'heavy', maxWidth: 920, fill: INK });
  const s4 = slide('paper', `${h4.svg}
    ${T("Put in your time and see roughly where you placed in your age group, here and at 60+ races across Southeast Asia.", { y: h4.bottom + 110, size: 46, fill: INK, maxWidth: 900 }).svg}
    ${pill({ x: 80, y: 900, w: 620, h: 110, label: 'runsea.run/tools', size: 52 })}`, { tag, page: 4, pages: P });

  const caption = `${short} ${e.core_facts.date.slice(0, 4)} in numbers.\n\n`
    + `${n(times.length)} runners finished the ${NOUN[main]}. 1 in ${oneIn} broke ${MILE_LABEL[main]} (${pct(share)}, against ${pct(region.underMilestone)} across Southeast Asia). The typical finish was ${hm(median)}, and the top 10% ran under ${hm(top10)}.\n\n`
    + `${ageLine}\n\n`
    + `Ran it? Put in your time at runsea.run/tools (link in bio) and see where you placed in your age group. Results are linked on the race's page at runsea.run.\n\n`
    + `${SHORT[slug]?.tags ?? ''} #running #halfmarathon #marathon #runsea`.replace(/\s+/g, ' ').trim();
  const name = `${e.core_facts.date}-${slug}`;
  posts.push({ name, caption, slides: [s1, s2, s3, s4] });
}

for (const p of posts) await renderPost(ROOT, p.name, p.slides);
fs.writeFileSync(path.join(ROOT, 'captions.md'), posts.map((p) => `## ${p.name}\n\n${p.caption}\n`).join('\n---\n\n'));
console.log(`wrote ${posts.length} recaps to ${ROOT}`);
