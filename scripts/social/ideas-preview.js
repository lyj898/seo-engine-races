#!/usr/bin/env node
// Preview batch: the 15 post ideas from 26 Oct 2026, each as a short carousel
// in one of the three looks (paper / poster / glow), numbered in posting
// order in OneDrive Documents\runsea-social\ideas-preview, with captions.md.
// Every number is computed from the site's own data when the script runs.
//
//   node scripts/social/ideas-preview.js
import fs from 'node:fs';
import path from 'node:path';
import { loadEntities, stripMeta, isReviewableEntity } from '../../src/lib/data.js';
import { loadFinishTimes } from '../../src/lib/finishTimes.js';
import { W, H, INK, LIME, PAPER, CREAM, MUTED, ORANGE, GREY, F, HV, esc, T, bib, pill, area, smooth, skyline, slide, renderPost } from './kit.js';

const OUT = path.join(process.env.USERPROFILE ?? '.', 'OneDrive', 'Documents', 'runsea-social', 'ideas-preview');
fs.rmSync(OUT, { recursive: true, force: true });

// ---- data ------------------------------------------------------------------
const ft = loadFinishTimes();
const ins = ft.insights;
const all = loadEntities().map(stripMeta);
const live = all.filter((e) => ['active', 'needs_review'].includes(e.status) && !e.core_facts?.event_status);
const bySlug = (s) => all.find((e) => e.slug === s);
const reviews = fs.readdirSync('data/reviews').map((f) => JSON.parse(fs.readFileSync(path.join('data/reviews', f), 'utf8'))).filter((r) => r.status === 'active' && r.at_a_glance);
const entById = new Map(all.map((e) => [e.entity_id, e]));
const n = (x) => Math.round(x).toLocaleString('en-US');
const hm = (s) => `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}`;
const ms = (s) => (s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(Math.round(s % 60)).padStart(2, '0')}` : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);
const clock = (k, s) => (k === '10K' ? ms(s) : hm(s));
const pct = (x) => `${Math.round(x * 100)}%`;
const beats = (q, t) => { if (t <= q[0]) return 100; if (t >= q[100]) return 0; for (let i = 0; i < 100; i++) if (t < q[i + 1]) return 100 - (i + (t - q[i]) / Math.max(1, q[i + 1] - q[i])); return 0; };
const clean = (name) => name.replace(/\s*\(.*?\)/g, '').replace(/\s*(Powered by JomRun®?|presented by.*|by Adidas)$/i, '').replace(/\s+–\s+.*Leg.*$/, '').replace(/\b20(25|26|27)\b/g, '').replace(/\s{2,}/g, ' ').trim();
const day = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const glance = (label) => reviews.flatMap((r) => r.at_a_glance.rows.filter((row) => label.test(row.label)).map((row) => ({ r, e: entById.get(r.entity_id), label: row.label, value: row.value })));
const density = (q, lo, hi, N = 40) => smooth(Array.from({ length: N }, (_, i) => { const a = lo + ((hi - lo) * i) / N, b = lo + ((hi - lo) * (i + 1)) / N; return Math.max(0, beats(q, a) - beats(q, b)); }));

const posts = [];
const add = (name, title, theme, slides, caption) => posts.push({ name, title, theme, slides, caption });
const TAGS = '#running #halfmarathon #marathon #runsea #southeastasia #runningsingapore #runningmalaysia #larimalaysia #runnersph #thailandrunning #vietnamrunners #lariindonesia';

// ---- 01 Same time, different race (paper) -----------------------------------
{
  const big = ft.raceQuantiles.filter((r) => r.distance === 'Half' && r.n >= 500).map((r) => ({ ...r, b: beats(r.q, 7200) }));
  const best = [...big].sort((a, b) => b.b - a.b)[0], worst = [...big].sort((a, b) => a.b - b.b)[0];
  const P = 4, tag = 'The Lab';
  const s1 = slide('paper', `
    ${T('Same time.', { y: 290, size: 100, weight: 'heavy', fill: INK, maxWidth: 960 }).svg}
    ${T('Different race.', { y: 400, size: 100, weight: 'heavy', fill: INK, opacity: 0.35, maxWidth: 960 }).svg}
    ${bib({ cx: 540, cy: 760, top: 'Half marathon', big: '2:00', bottom: 'Southeast Asia' })}
    ${pill({ x: 80, y: 1060, w: 430, label: `Top ${Math.round(100 - best.b)}%`, sub: `at ${clean(best.name)}` })}
    ${pill({ x: 570, y: 1060, w: 430, label: `Top ${Math.round(100 - worst.b)}%`, sub: `at ${clean(worst.name)}`, solid: false })}`, { tag, page: 1, pages: P });
  const s2 = slide('paper', `
    ${T('Why? Some fields are just faster.', { y: 280, size: 72, weight: 'heavy', fill: INK }).svg}
    ${T('Half of the field finished faster than…', { y: 520, size: 40, fill: INK, opacity: 0.6 }).svg}
    <text x="80" y="720" font-family="${HV}" font-weight="900" font-size="170" fill="${INK}">${hm(worst.q[50])}</text>
    ${T(`at ${clean(worst.name)}, ${worst.country}`, { y: 800, size: 40, weight: 700, fill: INK }).svg}
    <text x="80" y="1020" font-family="${HV}" font-weight="900" font-size="170" fill="${INK}" opacity="0.35">${hm(best.q[50])}</text>
    ${T(`at ${clean(best.name)}, ${best.country}`, { y: 1100, size: 40, weight: 700, fill: INK, opacity: 0.6 }).svg}`, { tag, page: 2, pages: P });
  const top5 = [...big].sort((a, b) => b.n - a.n).slice(0, 5).sort((a, b) => b.b - a.b);
  let y = 470;
  const rows = top5.map((r) => { const s = `${T(clean(r.name), { y, size: 40, weight: 700, fill: INK, maxWidth: 640 }).svg}<text x="${W - 80}" y="${y}" text-anchor="end" font-family="${HV}" font-weight="900" font-size="56" fill="${INK}">Top ${Math.round(100 - r.b)}%</text><line x1="80" x2="${W - 80}" y1="${y + 50}" y2="${y + 50}" stroke="${INK}" stroke-opacity="0.15" stroke-width="3"/>`; y += 130; return s; }).join('');
  const s3 = slide('paper', `${T('A 2:00 half at the five biggest races', { y: 260, size: 64, weight: 'heavy', fill: INK }).svg}${rows}`, { tag, page: 3, pages: P });
  const s4 = slide('paper', `
    ${T('Where does your time rank?', { y: 330, size: 100, weight: 'heavy', fill: INK }).svg}
    ${T('Put in your time. See your rank at every race, by gender and age.', { y: 720, size: 44, fill: INK }).svg}
    ${pill({ x: 80, y: 980, w: 620, h: 120, label: 'runsea.run/tools', size: 52 })}`, { tag, page: 4, pages: P });
  add('01-same-time-different-race', 'Same 2:00 half: top ' + Math.round(100 - best.b) + '% vs top ' + Math.round(100 - worst.b) + '%', 'paper', [s1, s2, s3, s4],
    `The same 2:00 half marathon puts you in the top ${Math.round(100 - best.b)}% at ${clean(best.name)} and only the top ${Math.round(100 - worst.b)}% at ${clean(worst.name)}.\n\nSome fields are simply faster: half of the runners at ${clean(worst.name)} finished under ${hm(worst.q[50])}, against ${hm(best.q[50])} at ${clean(best.name)}.\n\nWhere does YOUR time rank? Put it in at runsea.run/tools (link in bio) and see your rank at every race.\n\n${TAGS}`);
}

// ---- 02 Your 40s beat your 20s (poster) -------------------------------------
{
  const h = ins.Half; const ages = h.ages;
  const g = (b) => ages.find((a) => a.band === b);
  const P = 4, tag = 'The Lab';
  const s1 = slide('poster', `
    ${T('THE TYPICAL HALF MARATHON', { y: 200, size: 34, weight: 800, fill: INK, ls: 4 }).svg}
    <text x="70" y="470" font-family="${HV}" font-weight="900" font-size="230" letter-spacing="-8" fill="${INK}">IN YOUR</text>
    <text x="70" y="640" font-family="${HV}" font-weight="900" font-size="190" letter-spacing="-6" fill="${INK}">40s: ${hm(g('40-49').men)}</text>
    <text x="70" y="900" font-family="${HV}" font-weight="900" font-size="190" letter-spacing="-6" fill="${LIME}">20s: ${hm(g('20-29').men)}</text>
    ${T('Men, typical finish time by age. Older is faster.', { y: 1010, size: 40, weight: 600, fill: CREAM }).svg}`, { tag, page: 1, pages: P, split: 700 });
  let y = 480;
  const rows = ages.map((a) => { const fast = a.men && a.men - Math.min(...ages.filter((x) => x.men).map((x) => x.men)) <= 60; const s = `<text x="80" y="${y}" font-family="${F}" font-weight="800" font-size="52" fill="${fast ? LIME : CREAM}">${a.band === 'U20' ? 'Under 20' : a.band}</text><text x="640" y="${y}" text-anchor="middle" font-family="${HV}" font-weight="900" font-size="60" fill="${fast ? LIME : CREAM}">${a.men ? hm(a.men) : '–'}</text><text x="900" y="${y}" text-anchor="middle" font-family="${HV}" font-weight="900" font-size="60" fill="${fast ? LIME : CREAM}">${a.women ? hm(a.women) : '–'}</text>`; y += 110; return s; }).join('');
  const s2 = slide('ink', `${T('Typical half marathon time by age', { y: 250, size: 64, weight: 'heavy' }).svg}
    <text x="640" y="400" text-anchor="middle" font-family="${F}" font-weight="800" font-size="30" letter-spacing="4" fill="${MUTED}">MEN</text><text x="900" y="400" text-anchor="middle" font-family="${F}" font-weight="800" font-size="30" letter-spacing="4" fill="${MUTED}">WOMEN</text>${rows}`, { tag, page: 2, pages: P });
  const s3 = slide('ink', `${T('Why are older runners faster?', { y: 300, size: 80, weight: 'heavy' }).svg}
    ${T('Runners still racing in their 40s and 50s tend to be the committed ones, with years of training behind them.', { y: 620, size: 46 }).svg}
    ${T('Younger fields include far more first-timers, and that pulls the typical time down.', { y: 900, size: 46, fill: MUTED }).svg}`, { tag, page: 3, pages: P });
  const s4 = slide('poster', `${T('How do you compare with your age group?', { y: 330, size: 90, weight: 'heavy', fill: INK }).svg}
    <text x="80" y="960" font-family="${HV}" font-weight="900" font-size="88" fill="${LIME}">runsea.run/tools</text>
    ${T(`Based on ${n(h.finishes)} half marathon finishes.`, { y: 1060, size: 36, fill: CREAM }).svg}`, { tag, page: 4, pages: P, split: 700 });
  add('02-your-40s-beat-your-20s', 'Your 40s beat your 20s', 'poster', [s1, s2, s3, s4],
    `Runners in their 40s run faster half marathons than runners in their 20s. Typical men's finish: ${hm(g('40-49').men)} in your 40s, ${hm(g('20-29').men)} in your 20s (${hm(g('50-59').men)} in your 50s).\n\nWhy? The runners still racing in their 40s and 50s are the committed ones. Younger fields have far more first-timers.\n\nFrom ${n(h.finishes)} half marathon finishes across Southeast Asia. Compare yourself with your age group at runsea.run/tools (link in bio)\n\nTag the friend who says they're too old to get faster.\n\n${TAGS}`);
}

// ---- 03 Comment your time (paper) -------------------------------------------
{
  const q = (g) => ft.tables.Half.all[g].all;
  const TIERS = [['Elite', 1], ['Podium', 5], ['Front pack', 10], ['Strong', 25], ['Steady', 50]];
  const P = 3, tag = 'Your tier';
  const s1 = slide('paper', `
    ${T('Comment your half marathon time.', { y: 290, size: 88, weight: 'heavy', fill: INK }).svg}
    ${bib({ cx: 540, cy: 820, top: 'Your time', big: '?:??', bottom: 'Half marathon', rot: 5 })}
    ${T('We’ll reply with your tier.', { y: 1150, size: 48, weight: 700, fill: INK }).svg}`, { tag, page: 1, pages: P });
  let y = 470;
  const rows = TIERS.map(([name, p]) => { const s = `<text x="80" y="${y}" font-family="${HV}" font-weight="900" font-size="50" fill="${INK}">${name}</text><text x="80" y="${y + 40}" font-family="${F}" font-weight="600" font-size="28" fill="${INK}" opacity="0.6">top ${p}%</text><text x="660" y="${y}" text-anchor="middle" font-family="${HV}" font-weight="900" font-size="54" fill="${INK}">${hm(q('M')[p])}</text><text x="900" y="${y}" text-anchor="middle" font-family="${HV}" font-weight="900" font-size="54" fill="${INK}">${hm(q('F')[p])}</text>`; y += 130; return s; }).join('');
  const s2 = slide('paper', `${T('Half marathon tiers, Southeast Asia', { y: 250, size: 62, weight: 'heavy', fill: INK }).svg}
    <text x="660" y="390" text-anchor="middle" font-family="${F}" font-weight="800" font-size="30" letter-spacing="4" fill="${INK}" opacity="0.6">MEN</text><text x="900" y="390" text-anchor="middle" font-family="${F}" font-weight="800" font-size="30" letter-spacing="4" fill="${INK}" opacity="0.6">WOMEN</text>
    ${rows}${T('Faster than this time = that tier. Slower than Steady = Finisher, and every finish counts.', { y: 1150, size: 30, fill: INK, opacity: 0.6 }).svg}`, { tag, page: 2, pages: P });
  const s3 = slide('paper', `${T('Want it by your age group?', { y: 330, size: 96, weight: 'heavy', fill: INK }).svg}
    ${T('The Lab ranks your time against runners of your gender and age, at every race.', { y: 680, size: 44, fill: INK }).svg}
    ${pill({ x: 80, y: 960, w: 620, h: 120, label: 'runsea.run/tools', size: 52 })}`, { tag, page: 3, pages: P });
  add('03-comment-your-time', 'Comment your time, get your tier', 'paper', [s1, s2, s3],
    `Comment your half marathon time and we'll reply with your tier: Finisher, Steady, Strong, Front pack, Podium or Elite.\n\nThe cut-offs (all ages, Southeast Asia): Steady under ${hm(q('M')[50])} for men / ${hm(q('F')[50])} for women. Front pack under ${hm(q('M')[10])} / ${hm(q('F')[10])}. Elite under ${hm(q('M')[1])} / ${hm(q('F')[1])}.\n\nWant it by your age group? runsea.run/tools (link in bio)\n\n${TAGS}`);
}

// ---- 04 Midnight marathons (glow) -------------------------------------------
{
  const parse = (v) => { const m = v.match(/(\d{1,2})(?:[.:](\d{2}))?\s*(am|pm)/i); return m ? (Number(m[1]) % 12) * 60 + Number(m[2] || 0) : null; };
  const starts = glance(/^Start times?/i).map((x) => ({ ...x, t: parse(x.value) })).filter((x) => x.t != null && x.e).sort((a, b) => a.t - b.t);
  const seen = new Set(); const early = starts.filter((x) => { const k = clean(x.e.name); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 6);
  const label = (t) => (t === 0 ? 'Midnight' : `${Math.floor(t / 60) || 12}${t % 60 ? `.${String(t % 60).padStart(2, '0')}` : ''}am`);
  const midnight = early.filter((x) => x.t < 60).length;
  const P = 3, tag = 'Race o’clock';
  const s1 = slide('glow', `
    <circle cx="780" cy="420" r="150" fill="${CREAM}" opacity="0.92" filter="url(#glow)"/><circle cx="840" cy="380" r="150" fill="#1b2210"/>
    ${T('Would you start a marathon at midnight?', { y: 700, size: 96, weight: 'heavy' }).svg}
    ${T(`${midnight} races in Southeast Asia already do.`, { y: 1060, size: 44, weight: 600, fill: LIME }).svg}
    ${skyline(0.9, 0.55)}`, { tag, page: 1, pages: P });
  let y = 420;
  const rows = early.map((x) => { const nm = T(clean(x.e.name), { x: 400, y: y - 6, size: 40, weight: 700, maxWidth: 600 }); const s = `<text x="80" y="${y}" font-family="${HV}" font-weight="900" font-size="58" fill="${LIME}">${label(x.t)}</text>${nm.svg}<text x="400" y="${(nm.bottom + 30).toFixed(0)}" font-family="${F}" font-size="30" fill="${MUTED}">${esc(x.e.core_facts.country)}</text>`; y = Math.max(y + 130, nm.bottom + 110); return s; }).join('');
  const s2 = slide('glow', `${T('The earliest marathon starts', { y: 250, size: 68, weight: 'heavy' }).svg}${rows}`, { tag, page: 2, pages: P });
  const s3 = slide('glow', `${T('Midnight or 5am?', { y: 380, size: 110, weight: 'heavy' }).svg}
    ${T('Tell us in the comments: would you run a marathon through the night to beat the heat?', { y: 640, size: 46 }).svg}
    ${T('Start times, cut-offs and race-morning weather in every race review:', { y: 980, size: 34, fill: MUTED }).svg}
    <text x="80" y="1110" font-family="${HV}" font-weight="900" font-size="72" fill="${LIME}">runsea.run</text>`, { tag, page: 3, pages: P });
  add('04-midnight-marathons', 'Would you start a marathon at midnight?', 'glow', [s1, s2, s3],
    `Would you start a marathon at midnight?\n\n${early.map((x) => `${label(x.t)}: ${clean(x.e.name)} (${x.e.core_facts.country})`).join('\n')}\n\nIn the tropics, the only way to beat the heat is to race through the night. Midnight or 5am? Tell us below.\n\n${TAGS}`);
}

// ---- 05 Only 11% break four hours (glow) ------------------------------------
{
  const f = ins.Full; const q = ft.tables.Full.all.all.all;
  const lo = 150 * 60, hi = 420 * 60, N = 40, base = 1020, ch = 420;
  const d = density(q, lo, hi, N);
  const x4 = 80 + ((4 * 3600 - lo) / (hi - lo)) * (W - 160);
  const P = 4, tag = 'The Lab';
  const s1 = slide('glow', `
    <text x="70" y="560" font-family="${HV}" font-weight="900" font-size="340" letter-spacing="-12" fill="${LIME}" filter="url(#glow)">${pct(f.underMilestone)}</text>
    ${T('of marathoners in Southeast Asia break four hours.', { y: 720, size: 72, weight: 'heavy' }).svg}
    ${T(`From ${n(f.finishes)} marathon finishes. The sub-4 is rarer than you think.`, { y: 1040, size: 38, fill: MUTED }).svg}`, { tag, page: 1, pages: P });
  const h5 = T('Where marathons finish', { y: 250, size: 72, weight: 'heavy', maxWidth: 960 });
  const s2 = slide('glow', `${h5.svg}
    ${T('Lime: under four hours. The typical finish is ' + hm(f.median) + '.', { y: h5.bottom + 70, size: 38, fill: MUTED }).svg}
    <clipPath id="sub4"><rect x="0" y="0" width="${x4}" height="${H}"/></clipPath>
    <path d="${area(d, { base, h: ch })}" fill="#ffffff" fill-opacity="0.12"/>
    <path d="${area(d, { base, h: ch })}" fill="url(#gl)" clip-path="url(#sub4)" filter="url(#glow)"/>
    <line x1="${x4}" x2="${x4}" y1="560" y2="${base}" stroke="#fff" stroke-width="4" stroke-dasharray="10 10"/>
    <rect x="${x4 - 70}" y="520" width="140" height="56" rx="28" fill="#fff"/><text x="${x4}" y="559" text-anchor="middle" font-family="${HV}" font-weight="900" font-size="34" fill="${INK}">4:00</text>
    <text x="80" y="${base + 50}" font-family="${F}" font-size="30" fill="${MUTED}">${hm(lo)}</text><text x="${W - 80}" y="${base + 50}" text-anchor="end" font-family="${F}" font-size="30" fill="${MUTED}">${hm(hi)}</text>`, { tag, page: 2, pages: P });
  const row = (y, label, m, w, hi) => `<text x="80" y="${y}" font-family="${F}" font-weight="700" font-size="46" fill="${CREAM}">${label}</text><text x="640" y="${y}" text-anchor="middle" font-family="${HV}" font-weight="900" font-size="66" fill="${hi ? LIME : CREAM}">${m}</text><text x="900" y="${y}" text-anchor="middle" font-family="${HV}" font-weight="900" font-size="66" fill="${hi ? LIME : CREAM}">${w}</text>`;
  const s3 = slide('glow', `${T('What it takes, marathon', { y: 250, size: 72, weight: 'heavy' }).svg}
    <text x="640" y="470" text-anchor="middle" font-family="${F}" font-weight="800" font-size="30" letter-spacing="4" fill="${MUTED}">MEN</text><text x="900" y="470" text-anchor="middle" font-family="${F}" font-weight="800" font-size="30" letter-spacing="4" fill="${MUTED}">WOMEN</text>
    ${row(620, 'Top 1%', hm(f.men.top1), hm(f.women.top1), true)}${row(780, 'Top 10%', hm(f.men.top10), hm(f.women.top10))}${row(940, 'Typical', hm(f.men.median), hm(f.women.median))}`, { tag, page: 3, pages: P });
  const s4 = slide('glow', `${T('Sub-4 or not, how does your marathon rank?', { y: 380, size: 84, weight: 'heavy' }).svg}
    <text x="80" y="960" font-family="${HV}" font-weight="900" font-size="80" fill="${LIME}">runsea.run/tools</text>${skyline(0.9, 0.5)}`, { tag, page: 4, pages: P });
  add('05-sub-4-marathon', `Only ${pct(f.underMilestone)} break four hours`, 'glow', [s1, s2, s3, s4],
    `Only ${pct(f.underMilestone)} of marathoners in Southeast Asia finish under four hours.\n\nThe typical finish is ${hm(f.median)}. Top 10% takes ${hm(f.men.top10)} for men and ${hm(f.women.top10)} for women. So if you're chasing sub-4 in this heat, you're already chasing something rare.\n\nFrom ${n(f.finishes)} marathon finishes. Rank your marathon at runsea.run/tools (link in bio)\n\n${TAGS} #sub4`);
}

// ---- 06 Bucket list (paper) -------------------------------------------------
{
  const picks = [
    ['bank-jateng-borobudur-marathon-2026', 'Start and finish at a 9th-century temple'],
    ['bagan-marathon-bagan-temple-marathon-2026', 'Run among thousands of ancient temples'],
    ['halong-bay-heritage-marathon-2026', 'A UNESCO bay of limestone islands'],
    ['angkor-wat-international-half-marathon-2026', 'Through the temples of Angkor'],
    ['penang-bridge-international-marathon-2026', 'Across a 24 km sea bridge'],
    ['lake-toba-cross-island-run-2026', 'Round the lake in a supervolcano crater'],
  ].map(([s, line]) => ({ e: bySlug(s), line })).filter((x) => x.e);
  const P = 4, tag = 'Bucket list';
  const s1 = slide('paper', `
    ${T('Run past a temple.', { y: 290, size: 82, weight: 'heavy', fill: INK, maxWidth: 980 }).svg}
    ${T('Across a sea bridge.', { y: 395, size: 82, weight: 'heavy', fill: INK, opacity: 0.6, maxWidth: 980 }).svg}
    ${T('Round a volcano.', { y: 500, size: 82, weight: 'heavy', fill: INK, opacity: 0.35, maxWidth: 980 }).svg}
    ${bib({ cx: 540, cy: 900, w: 720, h: 420, top: 'Bucket list', big: `${picks.length} races`, bigSize: 150, bottom: 'Southeast Asia', rot: -4 })}`, { tag, page: 1, pages: P });
  const card = (x, y, { e, line }) => `<rect x="${x}" y="${y}" width="920" height="270" rx="30" fill="#ffffff" filter="url(#sh)"/>
    <rect x="${x}" y="${y}" width="22" height="270" rx="11" fill="${LIME}"/>
    <text x="${x + 60}" y="${y + 70}" font-family="${F}" font-weight="800" font-size="30" letter-spacing="3" fill="${INK}" opacity="0.6">${esc(day(e.core_facts.date).toUpperCase())} · ${esc(e.core_facts.country.toUpperCase())}</text>
    ${(() => { const nm = T(clean(e.name), { x: x + 60, y: y + 130, size: 46, weight: 'heavy', fill: INK, maxWidth: 820 }); return `${nm.svg}<text x="${x + 60}" y="${(nm.bottom + 48).toFixed(0)}" font-family="${F}" font-weight="600" font-size="32" fill="${INK}">${esc(line)}</text>`; })()}`;
  const s2 = slide('paper', picks.slice(0, 3).map((p, i) => card(80, 230 + i * 320, p)).join(''), { tag, page: 2, pages: P });
  const s3 = slide('paper', picks.slice(3, 6).map((p, i) => card(80, 230 + i * 320, p)).join(''), { tag, page: 3, pages: P });
  const s4 = slide('paper', `${T('Which one’s on your list?', { y: 360, size: 100, weight: 'heavy', fill: INK }).svg}
    ${T('Save this, tag your travel buddy, and find dates and official links for every race at runsea.run.', { y: 720, size: 44, fill: INK }).svg}
    ${pill({ x: 80, y: 1000, w: 520, h: 120, label: 'runsea.run', size: 56 })}`, { tag, page: 4, pages: P });
  add('06-bucket-list-races', 'Bucket-list races: temples, bridges, a volcano', 'paper', [s1, s2, s3, s4],
    `Run past a temple. Across a sea bridge. Round a volcano.\n\n${picks.map((p) => `${clean(p.e.name)}, ${p.e.core_facts.country} (${day(p.e.core_facts.date)}): ${p.line.toLowerCase()}`).join('\n')}\n\nWhich one's on your list? Save this and tag your travel buddy. Dates and official links at runsea.run (link in bio)\n\n${TAGS} #racecation #runtravel`);
}

// ---- 07 What it takes to be top 10% (paper) -----------------------------------
{
  const D = [['Half', 'Half marathon'], ['Full', 'Marathon'], ['10K', '10K']].filter(([k]) => ins[k]);
  const P = D.length + 2, tag = 'Top 10%';
  const s1 = slide('paper', `
    ${T('What it takes to finish in the top 10%', { y: 300, size: 96, weight: 'heavy', fill: INK }).svg}
    ${T('Half marathon, marathon and 10K. Southeast Asia, all ages.', { y: 680, size: 44, fill: INK, opacity: 0.7 }).svg}
    ${bib({ cx: 540, cy: 1000, w: 640, h: 340, top: 'Goal', big: 'Top 10%', bigSize: 130, bottom: 'Save this', rot: 4 })}`, { tag, page: 1, pages: P });
  const per = D.map(([k, label], i) => slide('paper', `
    ${T(label, { y: 260, size: 80, weight: 'heavy', fill: INK }).svg}
    ${bib({ cx: 540, cy: 600, w: 760, h: 420, top: 'Men', big: clock(k, ins[k].men.top10), bigSize: 190, bottom: `Typical: ${clock(k, ins[k].men.median)}`, rot: -5 })}
    ${bib({ cx: 540, cy: 1020, w: 760, h: 420, top: 'Women', big: clock(k, ins[k].women.top10), bigSize: 190, bottom: `Typical: ${clock(k, ins[k].women.median)}`, rot: 4, fill: INK, ink: LIME })}`, { tag, page: i + 2, pages: P }));
  const sl = slide('paper', `${T('Already there?', { y: 380, size: 110, weight: 'heavy', fill: INK }).svg}
    ${T('See exactly where you rank, by gender and age, and how far it is to the next tier.', { y: 680, size: 44, fill: INK }).svg}
    ${pill({ x: 80, y: 980, w: 620, h: 120, label: 'runsea.run/tools', size: 52 })}`, { tag, page: P, pages: P });
  add('07-top-10-percent', 'What it takes to be top 10%', 'paper', [s1, ...per, sl],
    `What it takes to finish in the top 10% in Southeast Asia:\n\n${D.map(([k, l]) => `${l}: ${clock(k, ins[k].men.top10)} (men), ${clock(k, ins[k].women.top10)} (women)`).join('\n')}\n\nSave this as your goal. Already there? See exactly where you rank at runsea.run/tools (link in bio)\n\n${TAGS}`);
}

// ---- 08 Hottest and coolest race mornings (glow) ------------------------------
{
  const w = glance(/^Weather at the .*start/i).map((x) => { const t = x.value.match(/(\d+)°C/), dp = x.value.match(/dew point (\d+)°C/), h = x.value.match(/(\d+)% humidity/); return { ...x, t: t && +t[1], dp: dp && +dp[1], h: h && +h[1] }; }).filter((x) => x.dp != null && x.e);
  const seen = new Set(); const uniq = w.filter((x) => { const k = clean(x.e.name); if (seen.has(k)) return false; seen.add(k); return true; });
  const hot = [...uniq].sort((a, b) => b.dp - a.dp || b.t - a.t).slice(0, 5), cool = [...uniq].sort((a, b) => a.dp - b.dp || a.t - b.t).slice(0, 5);
  const startOf = (x) => x.label.replace(/^Weather at the /i, '').replace(/ start$/i, '');
  const P = 4, tag = 'Race weather';
  const s1 = slide('glow', `
    ${T('Same region. Same hour.', { y: 270, size: 80, weight: 'heavy' }).svg}
    <text x="80" y="620" font-family="${HV}" font-weight="900" font-size="240" fill="${ORANGE}" filter="url(#glow)">${hot[0].t}°C</text>
    ${T(`${clean(hot[0].e.name)}, ${startOf(hot[0])}, ${hot[0].h}% humidity`, { y: 700, size: 38, weight: 600 }).svg}
    <text x="80" y="1000" font-family="${HV}" font-weight="900" font-size="240" fill="${LIME}" filter="url(#glow)">${cool[0].t}°C</text>
    ${T(`${clean(cool[0].e.name)}, ${startOf(cool[0])}`, { y: 1080, size: 38, weight: 600 }).svg}`, { tag, page: 1, pages: P });
  const list = (title, arr, color) => { let y = 430; return `${T(title, { y: 250, size: 72, weight: 'heavy' }).svg}${arr.map((x) => { const s = `<text x="80" y="${y}" font-family="${HV}" font-weight="900" font-size="64" fill="${color}">${x.t}°C</text>${T(clean(x.e.name), { x: 330, y: y - 10, size: 38, weight: 700, maxWidth: 680 }).svg}<text x="330" y="${y + 36}" font-family="${F}" font-size="28" fill="${MUTED}">${esc(`${x.e.core_facts.country} · ${startOf(x)} · dew point ${x.dp}°C · ${x.h}%`)}</text>`; y += 150; return s; }).join('')}`; };
  const s2 = slide('glow', list('The stickiest starts', hot, ORANGE), { tag, page: 2, pages: P });
  const s3 = slide('glow', list('The coolest starts', cool, LIME), { tag, page: 3, pages: P });
  const s4 = slide('glow', `${T('Watch the dew point, not the temperature', { y: 330, size: 80, weight: 'heavy' }).svg}
    ${T('Above about 24°C, sweat barely evaporates and every kilometre feels harder. Below 18°C, you can race.', { y: 680, size: 44 }).svg}
    ${T('Race-morning weather for every race we review:', { y: 980, size: 34, fill: MUTED }).svg}
    <text x="80" y="1100" font-family="${HV}" font-weight="900" font-size="72" fill="${LIME}">runsea.run</text>`, { tag, page: 4, pages: P });
  add('08-hottest-coolest-mornings', `${hot[0].t}°C vs ${cool[0].t}°C race mornings`, 'glow', [s1, s2, s3, s4],
    `Same region, same pre-dawn hour, very different races.\n\nStickiest starts: ${hot.map((x) => `${clean(x.e.name)} (${x.t}°C, ${x.h}% humidity)`).join('; ')}.\n\nCoolest starts: ${cool.map((x) => `${clean(x.e.name)} (${x.t}°C)`).join('; ')}.\n\nWatch the dew point: above about 24°C sweat barely evaporates. Race-morning weather from airport records, for every race we review at runsea.run (link in bio)\n\n${TAGS}`);
}

// ---- 09 Women in the field (poster) -----------------------------------------
{
  const D = [['10K', '10K'], ['Half', 'Half'], ['Full', 'Marathon']].filter(([k]) => ins[k]);
  const P = 3, tag = 'Women who run';
  const s1 = slide('poster', `
    ${T('WOMEN ARE…', { y: 200, size: 36, weight: 800, fill: INK, ls: 5 }).svg}
    <text x="60" y="500" font-family="${HV}" font-weight="900" font-size="300" letter-spacing="-10" fill="${INK}">${pct(ins['10K'].womenShare)}</text>
    ${T('of 10K finishers', { y: 600, size: 52, weight: 700, fill: INK }).svg}
    <text x="60" y="1010" font-family="${HV}" font-weight="900" font-size="300" letter-spacing="-10" fill="${LIME}">${pct(ins.Full.womenShare)}</text>
    ${T('of marathon finishers', { y: 1110, size: 52, weight: 700, fill: CREAM }).svg}`, { tag, page: 1, pages: P, split: 700 });
  let y = 440;
  const bars = D.map(([k, l]) => { const v = ins[k].womenShare; const s = `<text x="80" y="${y}" font-family="${F}" font-weight="800" font-size="46" fill="${CREAM}">${l}</text><rect x="80" y="${y + 30}" width="${(W - 160)}" height="90" rx="20" fill="#ffffff14"/><rect x="80" y="${y + 30}" width="${(W - 160) * v}" height="90" rx="20" fill="${LIME}"/><text x="${80 + (W - 160) * v + 20}" y="${y + 95}" font-family="${HV}" font-weight="900" font-size="54" fill="${CREAM}">${pct(v)}</text>`; y += 230; return s; }).join('');
  const s2 = slide('ink', `${T('Share of women, by distance', { y: 260, size: 70, weight: 'heavy' }).svg}${bars}
    ${T('The longer the race, the fewer women on the start line.', { y: 1150, size: 36, fill: MUTED }).svg}`, { tag, page: 2, pages: P });
  const s3 = slide('poster', `${T('Stepping up to your first half or full?', { y: 330, size: 86, weight: 'heavy', fill: INK }).svg}
    ${T('Tag a friend to do it with you.', { y: 900, size: 56, weight: 'heavy', fill: LIME }).svg}
    ${T('Race calendar and beginner-friendly races at runsea.run', { y: 1020, size: 36, fill: CREAM }).svg}`, { tag, page: 3, pages: P, split: 700 });
  add('09-women-in-the-field', `Women: ${pct(ins['10K'].womenShare)} of 10K, ${pct(ins.Full.womenShare)} of marathon`, 'poster', [s1, s2, s3],
    `Women make up ${pct(ins['10K'].womenShare)} of 10K finishers in Southeast Asia, ${pct(ins.Half.womenShare)} of half marathon finishers and just ${pct(ins.Full.womenShare)} of marathon finishers.\n\nThe longer the race, the fewer women on the start line. Thinking about stepping up? Tag the friend you'd do it with.\n\n${TAGS} #womenwhorun`);
}

// ---- 10 Teens run the fastest 10Ks (poster) ---------------------------------
{
  const a = ins['10K'].ages; const g = (b) => a.find((x) => x.band === b);
  const P = 3, tag = 'The Lab';
  const s1 = slide('poster', `
    ${T('THE FASTEST 10K RUNNERS ARE…', { y: 200, size: 36, weight: 800, fill: INK, ls: 3 }).svg}
    <text x="60" y="560" font-family="${HV}" font-weight="900" font-size="200" letter-spacing="-8" fill="${INK}">UNDER 20</text>
    <text x="60" y="960" font-family="${HV}" font-weight="900" font-size="230" letter-spacing="-8" fill="${LIME}">${ms(g('U20').men)}</text>
    ${T(`Typical 10K for men under 20. Runners in their 20s: ${ms(g('20-29').men)}.`, { y: 1060, size: 38, weight: 600, fill: CREAM }).svg}`, { tag, page: 1, pages: P, split: 700 });
  let y = 480;
  const rows = a.map((x) => { const fast = x.band === 'U20'; const s = `<text x="80" y="${y}" font-family="${F}" font-weight="800" font-size="52" fill="${fast ? LIME : CREAM}">${x.band === 'U20' ? 'Under 20' : x.band}</text><text x="640" y="${y}" text-anchor="middle" font-family="${HV}" font-weight="900" font-size="60" fill="${fast ? LIME : CREAM}">${x.men ? ms(x.men) : '–'}</text><text x="900" y="${y}" text-anchor="middle" font-family="${HV}" font-weight="900" font-size="60" fill="${fast ? LIME : CREAM}">${x.women ? ms(x.women) : '–'}</text>`; y += 110; return s; }).join('');
  const s2 = slide('ink', `${T('Typical 10K time by age', { y: 250, size: 70, weight: 'heavy' }).svg}
    <text x="640" y="400" text-anchor="middle" font-family="${F}" font-weight="800" font-size="30" letter-spacing="4" fill="${MUTED}">MEN</text><text x="900" y="400" text-anchor="middle" font-family="${F}" font-weight="800" font-size="30" letter-spacing="4" fill="${MUTED}">WOMEN</text>${rows}
    ${T('Many under-20s race 10Ks with school and club teams.', { y: 1180, size: 32, fill: MUTED }).svg}`, { tag, page: 2, pages: P });
  const s3 = slide('poster', `${T('Can you outrun a teenager?', { y: 330, size: 100, weight: 'heavy', fill: INK }).svg}
    <text x="80" y="960" font-family="${HV}" font-weight="900" font-size="88" fill="${LIME}">runsea.run/tools</text>`, { tag, page: 3, pages: P, split: 700 });
  add('10-teens-fastest-10k', 'Teens run the fastest 10Ks', 'poster', [s1, s2, s3],
    `The fastest 10K runners in Southeast Asia? Teenagers. The typical 10K for men under 20 is ${ms(g('U20').men)}, against ${ms(g('20-29').men)} for men in their 20s.\n\nCan you outrun a teenager? Check your 10K at runsea.run/tools (link in bio)\n\n${TAGS} #10k`);
}

// ---- 11 Most generous cut-offs (paper) --------------------------------------
{
  const cuts = glance(/^Cut-offs/i).map((x) => { const yr = [...x.value.matchAll(/20\d\d:\s*(\d+)\s*hours?(?:\s*(\d+))?/g)].at(-1); const m = yr ?? x.value.match(/[Mm]arathon[^,;.]*?(\d+(?:\.\d+)?)\s*hours?(?:\s*(\d+))?/); return { ...x, hrs: m ? +m[1] + (m[2] ? +m[2] / 60 : 0) : null }; }).filter((x) => x.hrs && x.e && !/half/i.test(x.value.slice(0, x.value.search(/\d/))));
  const seen = new Set(); const top = cuts.sort((a, b) => b.hrs - a.hrs).filter((x) => { const k = clean(x.e.name); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 6);
  const fmt = (h) => `${Math.floor(h)}h${h % 1 ? ` ${Math.round((h % 1) * 60)}` : ''}`;
  const P = 3, tag = 'First marathon';
  const s1 = slide('paper', `
    ${T('Worried about the cut-off?', { y: 300, size: 96, weight: 'heavy', fill: INK }).svg}
    ${bib({ cx: 540, cy: 800, top: 'Marathon cut-off', big: fmt(top[0].hrs).replace('h', ' HRS'), bigSize: 170, bottom: clean(top[0].e.name), rot: -5 })}
    ${T('The most generous marathons in Southeast Asia.', { y: 1150, size: 44, weight: 700, fill: INK }).svg}`, { tag, page: 1, pages: P });
  let y = 420;
  const rows = top.map((x) => { const nm = T(clean(x.e.name), { x: 340, y: y - 10, size: 40, weight: 700, fill: INK, maxWidth: 660 }); const s = `<text x="80" y="${y}" font-family="${HV}" font-weight="900" font-size="66" fill="${INK}">${fmt(x.hrs)}</text>${nm.svg}<text x="340" y="${(nm.bottom + 30).toFixed(0)}" font-family="${F}" font-size="28" fill="${INK}" opacity="0.6">${esc(`${x.e.core_facts.country} · ${day(x.e.core_facts.date)}`)}</text>`; y = Math.max(y + 130, nm.bottom + 110); return s; }).join('');
  const s2 = slide('paper', `${T('Longest marathon cut-offs', { y: 250, size: 70, weight: 'heavy', fill: INK }).svg}${rows}`, { tag, page: 2, pages: P });
  const s3 = slide('paper', `${T('Save this for your first marathon.', { y: 360, size: 96, weight: 'heavy', fill: INK }).svg}
    ${T('Cut-offs, start times and aid stations for every race we review, with dates and official links.', { y: 760, size: 44, fill: INK }).svg}
    ${pill({ x: 80, y: 1000, w: 520, h: 120, label: 'runsea.run', size: 56 })}`, { tag, page: 3, pages: P });
  add('11-generous-cut-offs', 'The most generous marathon cut-offs', 'paper', [s1, s2, s3],
    `Worried about the cut-off for your first marathon? These give you the most time:\n\n${top.map((x) => `${fmt(x.hrs)}: ${clean(x.e.name)} (${x.e.core_facts.country})`).join('\n')}\n\nSave this, and check each race's latest rules before you enter. Cut-offs for every race we review at runsea.run (link in bio)\n\n${TAGS} #firstmarathon`);
}

// ---- 12 Started at 71 (poster) ----------------------------------------------
{
  const P = 3, tag = 'Never too late';
  const s1 = slide('poster', `
    ${T('HE STARTED RUNNING AT', { y: 200, size: 40, weight: 800, fill: INK, ls: 4 }).svg}
    <text x="60" y="560" font-family="${HV}" font-weight="900" font-size="380" letter-spacing="-14" fill="${INK}">71</text>
    ${T('HE’S 82 NOW, AND STILL RACING', { y: 820, size: 40, weight: 800, fill: CREAM, ls: 3 }).svg}
    ${T('Lim Thiam Leng, oldest runner at the 2026 Kuching Half Marathon Heritage Run.', { y: 950, size: 40, weight: 600, fill: CREAM }).svg}`, { tag, page: 1, pages: P, split: 700 });
  const s2 = slide('ink', `
    <text x="60" y="380" font-family="${HV}" font-weight="900" font-size="260" fill="${LIME}">“</text>
    ${T('After retiring, I did not have much to do, so I started joining marathons when I was 71.', { y: 520, size: 64, weight: 'heavy' }).svg}
    ${T('Lim Thiam Leng, 82, to The Borneo Post', { y: 1060, size: 36, fill: MUTED }).svg}`, { tag, page: 2, pages: P });
  const s3 = slide('poster', `${T('What’s your excuse?', { y: 330, size: 110, weight: 'heavy', fill: INK }).svg}
    ${T('Tag someone who says they’re too old to start.', { y: 880, size: 52, weight: 'heavy', fill: LIME }).svg}
    ${T('Find your first race at runsea.run', { y: 1040, size: 38, fill: CREAM }).svg}`, { tag, page: 3, pages: P, split: 700 });
  add('12-started-at-71', 'He started running at 71', 'poster', [s1, s2, s3],
    `He started running at 71. He's 82 now, and still racing.\n\nLim Thiam Leng was the oldest runner at this year's Kuching Half Marathon Heritage Run. "After retiring, I did not have much to do, so I started joining marathons when I was 71," he told The Borneo Post.\n\nTag someone who says they're too old to start. Find your first race at runsea.run (link in bio)\n\n${TAGS} #nevertoolate #kuching`);
}

// ---- 13 Race, then beach (paper) --------------------------------------------
{
  const picks = ['langkawi-international-half-marathon-2026', 'kathu-marathon-2026', 'sanur-bali-international-half-marathon-2027', 'danang-international-marathon-2027', 'boracay-island-360-marathon-2027', 'laguna-phuket-marathon-2027'].map(bySlug).filter((e) => e && !e.core_facts.event_status);
  const P = 4, tag = 'Race-cation';
  const s1 = slide('paper', `
    ${T('Race on Sunday.', { y: 300, size: 100, weight: 'heavy', fill: INK }).svg}
    ${T('Beach by lunch.', { y: 415, size: 100, weight: 'heavy', fill: INK, opacity: 0.4 }).svg}
    <circle cx="540" cy="830" r="230" fill="${LIME}"/>
    <rect x="80" y="900" width="920" height="180" fill="${PAPER}"/>
    ${[0, 1, 2, 3].map((i) => `<path d="M80 ${930 + i * 38} Q 310 ${900 + i * 38} 540 ${930 + i * 38} T 1000 ${930 + i * 38}" stroke="${INK}" stroke-width="10" fill="none" stroke-linecap="round" opacity="${0.9 - i * 0.2}"/>`).join('')}
    ${T(`${picks.length} half and full marathons by the sea`, { y: 1170, size: 44, weight: 700, fill: INK }).svg}`, { tag, page: 1, pages: P });
  const card = (x, y, e) => `<rect x="${x}" y="${y}" width="920" height="250" rx="30" fill="#ffffff" filter="url(#sh)"/><rect x="${x}" y="${y}" width="22" height="250" rx="11" fill="${LIME}"/>
    <text x="${x + 60}" y="${y + 70}" font-family="${F}" font-weight="800" font-size="30" letter-spacing="3" fill="${INK}" opacity="0.6">${esc(day(e.core_facts.date).toUpperCase())}</text>
    ${(() => { const nm = T(clean(e.name), { x: x + 60, y: y + 130, size: 46, weight: 'heavy', fill: INK, maxWidth: 820 }); return `${nm.svg}<text x="${x + 60}" y="${(nm.bottom + 46).toFixed(0)}" font-family="${F}" font-weight="600" font-size="32" fill="${INK}">${esc(`${e.core_facts.city.split(',')[0]}, ${e.core_facts.country}`)}</text>`; })()}`;
  const s2 = slide('paper', picks.slice(0, 3).map((e, i) => card(80, 230 + i * 300, e)).join(''), { tag, page: 2, pages: P });
  const s3 = slide('paper', picks.slice(3, 6).map((e, i) => card(80, 230 + i * 300, e)).join(''), { tag, page: 3, pages: P });
  const s4 = slide('paper', `${T('Which beach are you racing to?', { y: 360, size: 96, weight: 'heavy', fill: INK }).svg}
    ${T('Save this for your next holiday. Dates, distances and official links at runsea.run.', { y: 760, size: 44, fill: INK }).svg}
    ${pill({ x: 80, y: 1000, w: 520, h: 120, label: 'runsea.run', size: 56 })}`, { tag, page: 4, pages: P });
  add('13-race-then-beach', 'Race on Sunday, beach by lunch', 'paper', [s1, s2, s3, s4],
    `Race on Sunday. Beach by lunch.\n\n${picks.map((e) => `${day(e.core_facts.date)}: ${clean(e.name)} (${e.core_facts.city.split(',')[0]}, ${e.core_facts.country})`).join('\n')}\n\nSave this for your next holiday and tag who you're going with. Dates and official links at runsea.run (link in bio)\n\n${TAGS} #racecation #beach`);
}

// ---- 14 The fastest fields (glow) -------------------------------------------
{
  const fields = ft.raceQuantiles.filter((r) => r.distance === 'Half' && r.n >= 500).sort((a, b) => a.q[50] - b.q[50]).slice(0, 5);
  const P = 3, tag = 'Fastest fields';
  const s1 = slide('glow', `
    ${T('The fastest half marathon crowd in Southeast Asia', { y: 280, size: 84, weight: 'heavy' }).svg}
    <text x="80" y="820" font-family="${HV}" font-weight="900" font-size="230" fill="${LIME}" filter="url(#glow)">${hm(fields[0].q[50])}</text>
    ${T(`Half the field finished faster than this at ${clean(fields[0].name)}, ${fields[0].country}.`, { y: 920, size: 42, weight: 600 }).svg}
    ${skyline(0.9, 0.45)}`, { tag, page: 1, pages: P });
  let y = 430;
  const rows = fields.map((r, i) => { const nm = T(clean(r.name), { x: 160, y: y - 8, size: 42, weight: 700, maxWidth: 560 }); const yy = y; y = Math.max(y + 140, nm.bottom + 115); return `<text x="80" y="${yy}" font-family="${HV}" font-weight="900" font-size="60" fill="${i === 0 ? LIME : CREAM}">${i + 1}</text>${nm.svg}<text x="160" y="${(nm.bottom + 30).toFixed(0)}" font-family="${F}" font-size="28" fill="${MUTED}">${esc(`${r.country} · ${n(r.n)} finishers`)}</text><text x="${W - 80}" y="${yy}" text-anchor="end" font-family="${HV}" font-weight="900" font-size="60" fill="${i === 0 ? LIME : CREAM}">${hm(r.q[50])}</text>`; }).join('');
  const s2 = slide('glow', `${T('Fastest fields: typical half marathon finish', { y: 250, size: 62, weight: 'heavy' }).svg}${rows}
    ${T('Races with 500+ half marathon finishers in the past two years.', { y: 1200, size: 30, fill: MUTED }).svg}`, { tag, page: 2, pages: P });
  const s3 = slide('glow', `${T('How would you rank in the fastest crowd?', { y: 380, size: 90, weight: 'heavy' }).svg}
    <text x="80" y="960" font-family="${HV}" font-weight="900" font-size="80" fill="${LIME}">runsea.run/tools</text>${skyline(0.9, 0.5)}`, { tag, page: 3, pages: P });
  add('14-fastest-fields', 'The fastest half marathon fields', 'glow', [s1, s2, s3],
    `The fastest half marathon crowds in Southeast Asia, by typical finish time:\n\n${fields.map((r, i) => `${i + 1}. ${clean(r.name)}, ${r.country}: ${hm(r.q[50])}`).join('\n')}\n\nHow would you rank against them? runsea.run/tools (link in bio)\n\n${TAGS}`);
}

// ---- 15 Haze season (poster) ------------------------------------------------
{
  const rev = all.filter(isReviewableEntity);
  const halted = rev.filter((e) => e.core_facts?.event_status && /^\d{4}-\d{2}-\d{2}$/.test(e.core_facts.date));
  const haze = halted.filter((e) => /haze|air quality|air pollutant|jerebu/i.test(e.core_facts.event_status_note ?? ''));
  const P = 3, tag = 'Haze season';
  const s1 = slide('poster', `
    ${T('SINCE SEPTEMBER, HAZE HAS CALLED OFF', { y: 200, size: 36, weight: 800, fill: INK, ls: 3, maxWidth: 900 }).svg}
    <text x="60" y="600" font-family="${HV}" font-weight="900" font-size="420" letter-spacing="-16" fill="${INK}">${haze.length}</text>
    ${T('half and full marathons in Malaysia and Singapore', { y: 870, size: 56, weight: 'heavy', fill: LIME }).svg}
    ${T(`${halted.length} races called off in all this season.`, { y: 1080, size: 38, fill: CREAM }).svg}`, { tag, page: 1, pages: P, split: 700 });
  const tips = [['Watch the night before', 'Many calls came late, some the evening before.'], ['Check the reading yourself', 'API in Malaysia, PSI and PM2.5 in Singapore.'], ['Book flexible travel', 'Refundable flights and hotels in the dry season.']];
  const hh = T('Racing in haze season?', { y: 260, size: 76, weight: 'heavy', maxWidth: 960 });
  let y = hh.bottom + 170;
  const tipSvg = tips.map(([h, b]) => { const s = `<text x="80" y="${y}" font-family="${HV}" font-weight="900" font-size="54" fill="${LIME}">${esc(h)}</text>${T(b, { y: y + 66, size: 40 }).svg}`; y += 230; return s; }).join('');
  const s2 = slide('ink', `${hh.svg}${tipSvg}`, { tag, page: 2, pages: P });
  const s3 = slide('poster', `${T('Every race called off this year', { y: 330, size: 96, weight: 'heavy', fill: INK }).svg}
    <text x="80" y="900" font-family="${HV}" font-weight="900" font-size="64" fill="${LIME}">runsea.run/</text><text x="80" y="980" font-family="${HV}" font-weight="900" font-size="64" fill="${LIME}">race-cancellations</text>
    ${T('With the organiser’s reason and a source for each.', { y: 1080, size: 36, fill: CREAM }).svg}`, { tag, page: 3, pages: P, split: 700 });
  add('15-haze-season', `${haze.length} races called off for haze`, 'poster', [s1, s2, s3],
    `Since September, haze has called off ${haze.length} half and full marathons in Malaysia and Singapore, and ${halted.length} races have been called off in all.\n\nRacing in the dry season? Watch your organiser's page the night before, check the API or PSI yourself, and book flexible travel.\n\nEvery race called off this year, with the reason and a source: runsea.run/race-cancellations (link in bio)\n\n${TAGS} #haze #jerebu`);
}

// ---- render -----------------------------------------------------------------
const md = [];
for (const p of posts) {
  const files = await renderPost(OUT, p.name, p.slides);
  md.push(`## ${p.name}: ${p.title}\n\nDesign: ${p.theme} · ${files.length} slides\n\n${p.caption}\n`);
}
fs.writeFileSync(path.join(OUT, '00-captions.md'), `# Run SEA post ideas: preview\n\nFiles are named in posting order (01 to ${String(posts.length).padStart(2, '0')}), slides in swipe order.\n\n${md.join('\n---\n\n')}`);
console.log(`wrote ${posts.length} posts, ${posts.reduce((s, p) => s + p.slides.length, 0)} slides to ${OUT}`);
