// Native 9:16 motion Reels: each frame is an SVG drawn at time t, rendered
// with sharp and encoded with ffmpeg. A story is a list of timed scenes
// (hook, bars, pair, list) built from the Lab data, and every Reel ends on a
// follow card. Captions are written next to the videos.
//
//   FFMPEG=path/to/ffmpeg node scripts/social/reel-motion.js <folder-name> <story> [<story> ...]
//
// Output: OneDrive/Documents/runsea-social/<folder-name>/<story>.mp4 plus
// captions.md (videos are silent; music is added in Business Suite).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { loadFinishTimes } from '../../src/lib/finishTimes.js';
import { loadEntities, stripMeta } from '../../src/lib/data.js';
import { INK, LIME, CREAM, MUTED, F, esc } from './kit.js';

const [folder, ...names] = process.argv.slice(2);
const FFMPEG = process.env.FFMPEG;
if (!folder || !names.length || !FFMPEG) { console.error('usage: FFMPEG=path node scripts/social/reel-motion.js <folder-name> <story> [...]'); process.exit(1); }
const OUT = path.join(process.env.USERPROFILE ?? '.', 'OneDrive', 'Documents', 'runsea-social', folder);
const W = 1080, H = 1920, FPS = 30;
const HVY = "'Segoe UI Black', 'Arial Black', sans-serif";
const TAGS = '#running #halfmarathon #marathon #southeastasia #runningsingapore #larimalaysia #runnersph #runsea';
const FOLLOW = 'Follow @runsea.run for a new race stat every day.';

// Colour palettes. Every scene draws from the active one (C); `brand` is the
// original lime-on-ink look. bars: colours for ordinary bars, in turn.
const PALETTES = {
  brand: { bg1: INK, bg2: INK, fg: CREAM, accent: LIME, muted: MUTED, bars: ['#8a9a52'], ink: INK, track: '#ffffff', trackOp: 0.08, blob: LIME, blobOp: 0.16 },
  sunset: { bg1: '#ff6a3d', bg2: '#d6246e', fg: '#fffaf2', accent: '#ffe14d', muted: '#ffe1d4', bars: ['#ffc2d6', '#ffd9a0'], ink: '#3a0b2b', track: '#ffffff', trackOp: 0.2, blob: '#ffd166', blobOp: 0.35 },
  ocean: { bg1: '#00b4db', bg2: '#0a3d91', fg: '#ffffff', accent: '#ffe14d', muted: '#cdeeff', bars: ['#7fe3ff', '#b2f5ea'], ink: '#002a5c', track: '#ffffff', trackOp: 0.18, blob: '#7fe3ff', blobOp: 0.35 },
  grape: { bg1: '#6a1bd6', bg2: '#d4148f', fg: '#ffffff', accent: '#c8ff33', muted: '#f1d6ff', bars: ['#e0b3ff', '#ffb3e6'], ink: '#2a0050', track: '#ffffff', trackOp: 0.18, blob: '#ff7ad9', blobOp: 0.35 },
  mint: { bg1: '#00a88f', bg2: '#5fae2e', fg: '#ffffff', accent: '#fff36b', muted: '#e0fff2', bars: ['#b8ffe4', '#e6ffb3'], ink: '#05342a', track: '#ffffff', trackOp: 0.2, blob: '#c8ff33', blobOp: 0.3 },
  fire: { bg1: '#e8290f', bg2: '#f59e0b', fg: '#ffffff', accent: '#fff3b0', muted: '#ffe4cc', bars: ['#ffd0b0', '#ffe7a3'], ink: '#3b0d00', track: '#ffffff', trackOp: 0.2, blob: '#ffd23f', blobOp: 0.35 },
  neon: { bg1: '#120c3a', bg2: '#35206e', fg: '#ffffff', accent: '#ff2e97', muted: '#c7c0ff', bars: ['#00e5ff', '#7cff6b', '#ffd23f', '#b388ff'], ink: '#120c3a', track: '#ffffff', trackOp: 0.12, blob: '#ff2e97', blobOp: 0.3 },
  royal: { bg1: '#1b2a6b', bg2: '#0b1335', fg: '#ffffff', accent: '#ffb703', muted: '#c9d3ff', bars: ['#8ecae6', '#a5b4fc'], ink: '#0b1335', track: '#ffffff', trackOp: 0.12, blob: '#ffb703', blobOp: 0.28 },
  peach: { bg1: '#ffd6a5', bg2: '#ff8fa3', fg: '#2b1220', accent: '#7b1fa2', muted: '#5a2a3a', bars: ['#ffffff', '#ffe5ec'], ink: '#2b1220', track: '#ffffff', trackOp: 0.35, blob: '#ffffff', blobOp: 0.45 },
  citrus: { bg1: '#f7971e', bg2: '#ffcf1f', fg: '#2a1600', accent: '#c4004b', muted: '#5c3a00', bars: ['#ffffff', '#fff1c1'], ink: '#2a1600', track: '#ffffff', trackOp: 0.35, blob: '#ffffff', blobOp: 0.4 },
  lagoon: { bg1: '#0f9b8e', bg2: '#1b4f9c', fg: '#ffffff', accent: '#ffd23f', muted: '#d6fff6', bars: ['#9ef0e1', '#a9c8ff'], ink: '#062b3a', track: '#ffffff', trackOp: 0.18, blob: '#9ef0e1', blobOp: 0.3 },
};
let C = PALETTES.brand, NOW = 0;

// ---- easing and drawing helpers ---------------------------------------------
const clamp = (x) => Math.max(0, Math.min(1, x));
const ease = (x) => 1 - (1 - clamp(x)) ** 3;
const at = (s, start, dur = 0.5) => ease((s - start) / dur);
// Shrinks the font until the line fits maxW (average glyph widths for Segoe UI).
const fit = (str, size, maxW, heavy, ls) => {
  const caps = /[A-Z]/.test(str) && str === String(str).toUpperCase();
  return Math.min(size, maxW / (String(str).length * ((heavy ? 0.6 : 0.54) + (caps ? 0.1 : 0) + ls / size)));
};
const text = (str, { x = 90, y, size: want = 64, fill = C.fg, weight = 800, heavy = false, anchor = 'start', p = 1, ls = 0, maxW = W - 180 }) => {
  const size = fit(str, want, maxW, heavy, ls);
  return `<text x="${x}" y="${(y + (1 - p) * 40).toFixed(1)}" text-anchor="${anchor}" opacity="${p.toFixed(3)}" font-family="${heavy ? HVY : F}" font-weight="${heavy ? 900 : weight}" font-size="${size}" letter-spacing="${ls}" fill="${fill}">${esc(str)}</text>`;
};
// Background: the palette's gradient with two soft colour blobs drifting slowly.
const frame = (body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs><filter id="glow"><feGaussianBlur stdDeviation="12" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <linearGradient id="bg" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" stop-color="${C.bg1}"/><stop offset="1" stop-color="${C.bg2}"/></linearGradient>
  <radialGradient id="blob"><stop offset="0" stop-color="${C.blob}" stop-opacity="${C.blobOp}"/><stop offset="1" stop-color="${C.blob}" stop-opacity="0"/></radialGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <circle cx="${(820 + 160 * Math.sin(NOW * 0.5)).toFixed(1)}" cy="${(330 + 120 * Math.cos(NOW * 0.4)).toFixed(1)}" r="560" fill="url(#blob)"/>
  <circle cx="${(220 + 180 * Math.cos(NOW * 0.35)).toFixed(1)}" cy="${(1550 + 140 * Math.sin(NOW * 0.45)).toFixed(1)}" r="520" fill="url(#blob)"/>
  <text x="90" y="170" font-family="${F}" font-weight="800" font-size="32" letter-spacing="7" fill="${C.accent}">RUN SEA</text>
  ${body}
  <text x="90" y="${H - 120}" font-family="${F}" font-weight="800" font-size="34" fill="${C.fg}" opacity="0.85">@runsea.run</text>
</svg>`;
const hm = (s) => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`; };
const n = (x) => Math.round(x).toLocaleString('en-US');
// Bar length for times: measured from 70% of the fastest, so real gaps show.
const timeScale = (vals) => { const lo = Math.min(...vals) * 0.7, hi = Math.max(...vals); return (v) => (v - lo) / (hi - lo); };

// ---- scene kinds (s = seconds since the scene started) ------------------------
const KINDS = {
  // Up to four lines of big type, one after another.
  hook: (s, { kicker, lines, sub }) => {
    // One size for every line, set by the longest.
    const size = Math.min(...lines.map(([str]) => fit(str, 140, W - 180, true, 0)));
    return `${kicker ? text(kicker, { y: 760, size: 52, ls: 4, p: at(s, 0.05) }) : ''}
    ${lines.map(([str, hi], i) => text(str, { y: 900 + i * size * 1.15, size, heavy: true, fill: hi ? C.accent : C.fg, p: at(s, 0.35 + i * 0.35) })).join('')}
    ${sub ? text(sub, { y: 900 + lines.length * size * 1.15 + 30, size: 46, weight: 600, fill: C.muted, p: at(s, 0.5 + lines.length * 0.35) }) : ''}`;
  },
  // Horizontal bars that grow; `rows`: { label, value (0-1 of the bar), show (final text), hi }.
  bars: (s, { title, sub, rows, foot }) => {
    // Rows share the space between the subtitle and the closing line.
    const top = 620, bottom = 1580, gap = Math.min(300, (bottom - top) / rows.length), bh = Math.min(100, gap - 90), max = 900;
    return `${text(title, { y: 380, size: 66, heavy: true, p: at(s, 0) })}
      ${sub ? text(sub, { y: 455, size: 40, weight: 600, fill: C.muted, p: at(s, 0.2) }) : ''}
      ${rows.map((r, i) => {
        const p = at(s, 0.3 + i * 0.45, 1.0), y = top + i * gap, w = Math.max(1, max * r.value * p), vs = Math.min(62, bh * 0.62);
        // Value label after the bar, or inside its end in dark type when there's no room.
        const inside = 90 + max * r.value + 24 + String(r.show).length * vs * 0.6 > W - 60;
        return `${text(r.label, { y, size: Math.min(52, gap * 0.26), weight: 800, p: at(s, 0.1 + i * 0.45) })}
          <rect x="90" y="${y + 30}" width="${max}" height="${bh}" rx="18" fill="${C.track}" opacity="${C.trackOp}"/>
          <rect x="90" y="${y + 30}" width="${w.toFixed(1)}" height="${bh}" rx="18" fill="${r.hi ? C.accent : C.bars[i % C.bars.length]}" ${r.hi ? 'filter="url(#glow)"' : ''}/>
          ${inside ? text(r.show, { x: 70 + w, anchor: 'end', y: y + 30 + bh * 0.72, size: vs, heavy: true, fill: C.ink, p })
            : text(r.show, { x: 110 + w, y: y + 30 + bh * 0.72, size: vs, heavy: true, p })}`;
      }).join('')}
      ${foot ? text(foot, { y: 1700, size: 46, weight: 700, fill: C.accent, p: at(s, 0.6 + rows.length * 0.45) }) : ''}`;
  },
  // Two big numbers that count up, one above the other.
  pair: (s, { title, a, b, foot }) => {
    const row = (r, y, i) => {
      const p = at(s, 0.4 + i * 0.9, 1.1);
      return `${text(r.label, { y, size: 56, weight: 800, fill: r.hi ? C.accent : C.fg, p: at(s, 0.2 + i * 0.9) })}
        ${text(r.fmt ? r.fmt(r.value * p) : n(r.value * p), { y: y + 190, size: 200, heavy: true, fill: r.hi ? C.accent : C.fg, p: Math.min(1, p * 3) })}
        ${r.unit ? text(r.unit, { y: y + 260, size: 42, weight: 600, fill: C.muted, p: at(s, 0.6 + i * 0.9) }) : ''}`;
    };
    return `${text(title, { y: 380, size: 66, heavy: true, p: at(s, 0) })}${row(a, 620, 0)}${row(b, 1060, 1)}
      ${foot ? text(foot, { y: 1560, size: 48, weight: 700, fill: C.accent, p: at(s, 2.4) }) : ''}`;
  },
  // A ranked list that appears line by line.
  // items: [label, value, highlight?, sub-line?]; rows share the space available.
  list: (s, { title, sub, items, foot, step = 0.4 }) => {
    const gap = Math.min(190, 1000 / items.length);
    return `${text(title, { y: 380, size: 66, heavy: true, p: at(s, 0) })}
    ${sub ? text(sub, { y: 455, size: 40, weight: 600, fill: C.muted, p: at(s, 0.2) }) : ''}
    ${items.map(([l, r, hi, sl], i) => `${text(l, { y: 640 + i * gap, size: Math.min(60, gap * 0.34), weight: 800, fill: hi ? C.accent : C.fg, p: at(s, 0.3 + i * step), maxW: 560 })}
      ${sl ? text(sl, { y: 640 + i * gap + Math.min(46, gap * 0.27), size: Math.min(36, gap * 0.2), weight: 600, fill: C.muted, p: at(s, 0.35 + i * step), maxW: 560 }) : ''}
      ${text(r, { x: W - 90, anchor: 'end', y: 640 + i * gap, size: Math.min(96, gap * 0.5), heavy: true, fill: hi ? C.accent : C.fg, p: at(s, 0.45 + i * step), maxW: 250 })}`).join('')}
    ${foot ? text(foot, { y: 1700, size: 46, weight: 700, fill: C.accent, p: at(s, 0.6 + items.length * step) }) : ''}`;
  },
  follow: (s, { line = 'A new race stat every day.' }) => `${text('Follow', { y: 760, size: 150, heavy: true, fill: C.accent, p: at(s, 0) })}
    ${text('@runsea.run', { y: 900, size: 96, heavy: true, p: at(s, 0) })}
    ${text(line, { y: 1060, size: 54, weight: 600, p: at(s, 0.35) })}
    ${text('Rank your own time: runsea.run/tools', { y: 1170, size: 42, weight: 600, fill: C.muted, p: at(s, 0.7) })}`,
};
/** Story from [duration, kind, props] steps; the follow card is appended. */
const story = (topic, steps, caption, pal = 'brand', cover = pal !== 'brand') => {
  const scenes = []; let t = 0;
  for (const [dur, kind, props] of [...steps, [2.6, 'follow', {}]]) { scenes.push({ t0: t, t1: t + dur, kind, props }); t += dur; }
  return { topic, dur: t, scenes, caption, draw(time) {
    C = PALETTES[pal]; NOW = time;
    const sc = scenes.find((x) => time < x.t1) ?? scenes.at(-1);
    // The first scene starts already drawn, so the Reel's cover frame isn't empty.
    const lead = cover && sc === scenes[0] ? 1.6 : 0;
    return frame(KINDS[sc.kind](time - sc.t0 + lead, sc.props));
  } };
};

// ---- data -----------------------------------------------------------------------
const ft = loadFinishTimes();
const used = new Set(ft.races.map((r) => `${r.slug}|${r.distance}`));
const pool = { Half: [], Full: [], '10K': [] };
const fields = [];
for (const f of fs.readdirSync(path.join('data', 'finish-times'))) {
  const d = JSON.parse(fs.readFileSync(path.join('data', 'finish-times', f), 'utf8'));
  for (const [k, v] of Object.entries(d.distances)) {
    if (!used.has(`${d.slug}|${k}`)) continue;
    for (const x of v.times) pool[k].push(x);
    if (k === 'Half') fields.push({ n: v.times.length, med: v.times.map((x) => x[0]).sort((a, b) => a - b)[Math.floor(v.times.length / 2)] });
  }
}
const q = (a, p) => a[Math.round(p * (a.length - 1))];
const inMinute = (k, lo) => pool[k].filter(([t]) => t >= lo && t < lo + 60).length;
const median = (arr) => { const v = [...arr].sort((a, b) => a - b); return q(v, 0.5); };
const modeMinute = (k) => { const c = {}; for (const [t] of pool[k]) { const m = Math.floor(t / 60); c[m] = (c[m] ?? 0) + 1; } return +Object.entries(c).sort((a, b) => b[1] - a[1])[0][0] * 60; };
const shareUnder = (k, c, mile) => { const v = pool[k].filter((x) => x[0] > 0); return v.filter(([t]) => t < mile).length / v.length; };
const allEnts = loadEntities().map(stripMeta);
const entById = new Map(allEnts.map((e) => [e.entity_id, e]));
const bySlug = (slug) => allEnts.find((e) => e.slug === slug);
const clean = (name) => name.replace(/\s*\(.*?\)/g, '').replace(/\s*(Powered by.*|presented by.*|by Adidas)$/i, '').replace(/\b20(25|26|27)\b/g, '').replace(/\s{2,}/g, ' ').trim();
const day = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const reviews = fs.readdirSync(path.join('data', 'reviews')).map((f) => JSON.parse(fs.readFileSync(path.join('data', 'reviews', f), 'utf8'))).filter((r) => r.status === 'active' && r.at_a_glance);
const glance = (label) => reviews.flatMap((r) => r.at_a_glance.rows.filter((row) => label.test(row.label)).map((row) => ({ e: entById.get(r.entity_id), label: row.label, value: row.value }))).filter((x) => x.e);
const uniqBy = (arr, key) => { const seen = new Set(); return arr.filter((x) => { const k = key(x); if (seen.has(k)) return false; seen.add(k); return true; }); };
// Per race and distance (latest editions the Lab uses), with country.
const raceRows = [];
for (const f of fs.readdirSync(path.join('data', 'finish-times'))) {
  const d = JSON.parse(fs.readFileSync(path.join('data', 'finish-times', f), 'utf8'));
  for (const [k, v] of Object.entries(d.distances)) {
    const m = ft.races.find((r) => r.slug === d.slug && r.distance === k);
    if (m) raceRows.push({ slug: d.slug, name: m.name, country: m.country, k, times: v.times });
  }
}
const ageShare = (k, bands) => { const v = pool[k].filter((x) => x[2]); return v.filter((x) => bands.includes(x[2])).length / v.length; };
const pct = (x) => `${Math.round(x * 100)}%`;
const ents = loadEntities().map(stripMeta).filter((e) => ['active', 'needs_review'].includes(e.status) && !e.core_facts?.event_status && (e.core_facts?.date ?? '') >= new Date().toISOString().slice(0, 10));

const STORIES = {
  'two-hour-wall': (() => {
    const u = inMinute('Half', 7140), o = inMinute('Half', 7200), fu = inMinute('Full', 14340), fo = inMinute('Full', 14400);
    return story('pacing psychology', [
      [2.6, 'hook', { kicker: 'HALF MARATHON FINISH TIMES', lines: [['Spot the', false], ['2-hour wall.', true]] }],
      [4.6, 'pair', { title: 'Half marathon finishers', a: { label: 'Finished in 1:59:xx', value: u, hi: true }, b: { label: 'Finished in 2:00:xx', value: o }, foot: `${Math.round((u / o - 1) * 100)}% more, one minute apart.` }],
      [3.4, 'hook', { kicker: 'MARATHON, AT 4:00', lines: [[`${n(fu)} vs ${n(fo)}`, true]], sub: 'Twice as many squeeze in under four hours.' }],
    ], `The 2-hour wall is real.\n\n${n(u)} half marathoners in Southeast Asia finished in 1:59-something. Only ${n(o)} finished a minute later, in 2:00-something. That's ${Math.round((u / o - 1) * 100)}% more, one minute apart. In the marathon it's even starker at four hours: ${n(fu)} against ${n(fo)}.\n\nRunners find a sprint when a round number is on the clock. Which side of the wall were you?\n\nFrom ${n(pool.Half.length)} half and ${n(pool.Full.length)} marathon finishes across Southeast Asia. ${FOLLOW}\n\n${TAGS} #sub2 #sub4`);
  })(),
  'fastest-country-half': (() => {
    const cs = ft.countries.Half, sc = timeScale(cs.map((c) => c.median));
    return story('country rivalry', [
      [2.4, 'hook', { kicker: 'HALF MARATHON', lines: [['Which country', false], ['runs fastest?', true]] }],
      [5.6, 'bars', { title: 'Typical half marathon finish', sub: 'Each race counts equally. Shorter is faster.', rows: cs.map((c, i) => ({ label: c.country, value: sc(c.median), show: hm(c.median), hi: i === 0 })), foot: `${cs[0].country} leads by ${Math.round((cs.at(-1).median - cs[0].median) / 60)} minutes.` }],
    ], `Which country in Southeast Asia runs the fastest half marathon?\n\n${cs.map((c, i) => `${i + 1}. ${c.country}: ${hm(c.median)}`).join('\n')}\n\nTypical finish time, with each race counted equally so one giant race can't decide a country (${cs.map((c) => c.races).reduce((a, b) => a + b, 0)} races, ${n(cs.reduce((a, c) => a + c.finishes, 0))} finishes; Singapore needs a third race in the data to be ranked). Does your country's spot surprise you?\n\n${FOLLOW}\n\n${TAGS} #thailandrunning #vietnamrunners`);
  })(),
  'most-common-times': (() => {
    const h = modeMinute('Half'), f = modeMinute('Full'), k = modeMinute('10K');
    return story('am I average', [
      [2.4, 'hook', { kicker: 'SOUTHEAST ASIA', lines: [['The most', false], ['common', false], ['finish time.', true]] }],
      [5.0, 'list', { title: 'The most common finish', sub: 'More runners cross the line in this minute than any other', items: [['10K', hm(k), false], ['Half marathon', hm(h), true], ['Marathon', hm(f), false]], foot: 'Faster or slower than the crowd?' }],
    ], `The most common finish times in Southeast Asia, the minute more runners cross the line in than any other:\n\n10K: ${hm(k)}\nHalf marathon: ${hm(h)}\nMarathon: ${hm(f)}\n\nAre you faster or slower than the crowd? Tell us your time below.\n\nFrom ${n(pool['10K'].length + pool.Half.length + pool.Full.length)} finishes. See exactly where you rank at runsea.run/tools (link in bio). ${FOLLOW}\n\n${TAGS}`);
  })(),
  'bigger-races-slower': (() => {
    const band = (lo, hi) => median(fields.filter((r) => r.n >= lo && r.n < hi).map((r) => r.med));
    const rows = [['Under 500 finishers', band(0, 500)], ['500 to 1,500', band(500, 1500)], ['1,500 to 4,000', band(1500, 4000)], ['Over 4,000', band(4000, 1e9)]];
    const sc = timeScale(rows.map((r) => r[1]));
    return story('race choice', [
      [2.4, 'hook', { kicker: 'HALF MARATHON', lines: [['Bigger race,', false], ['slower field.', true]] }],
      [5.4, 'bars', { title: 'Typical finish by race size', sub: `Median of each race's typical half, ${fields.length} races`, rows: rows.map(([l, v], i) => ({ label: l, value: sc(v), show: hm(v), hi: i === 0 })), foot: 'Want to finish higher up? Go small.' }],
    ], `Bigger race, slower field.\n\nTypical half marathon finish by race size in Southeast Asia:\n${rows.map(([l, v]) => `${l}: ${hm(v)}`).join('\n')}\n\nWant a race where you'll finish further up the field? Look small.\n\nFrom ${fields.length} half marathons. ${FOLLOW}\n\n${TAGS}`);
  })(),
  'sub4-by-country': (() => {
    const by = {};
    for (const r of ft.races.filter((x) => x.distance === 'Full')) by[r.country] = r.country;
    const rows = [];
    for (const c of new Set(ft.races.filter((x) => x.distance === 'Full').map((x) => x.country))) {
      const slugs = new Set(ft.races.filter((x) => x.distance === 'Full' && x.country === c).map((x) => x.slug));
      let tot = 0, sub = 0;
      for (const f of fs.readdirSync(path.join('data', 'finish-times'))) {
        const d = JSON.parse(fs.readFileSync(path.join('data', 'finish-times', f), 'utf8'));
        if (!slugs.has(d.slug) || !d.distances.Full) continue;
        tot += d.distances.Full.times.length; sub += d.distances.Full.times.filter(([t]) => t < 14400).length;
      }
      if (tot >= 800) rows.push([c, sub / tot, tot]);
    }
    rows.sort((a, b) => b[1] - a[1]);
    return story('country rivalry', [
      [2.4, 'hook', { kicker: 'MARATHON', lines: [['Where do', false], ['runners go', false], ['sub-4?', true]] }],
      [5.4, 'bars', { title: 'Marathoners under 4 hours', sub: 'Share of finishers, by country', rows: rows.map(([c, s], i) => ({ label: c, value: s / rows[0][1], show: `${Math.round(s * 100)}%`, hi: i === 0 })), foot: `Across the region: ${Math.round(ft.insights.Full.underMilestone * 100)}%.` }],
    ], `Where do marathoners break four hours?\n\n${rows.map(([c, s, t]) => `${c}: ${Math.round(s * 100)}% (${n(t)} finishers)`).join('\n')}\n\nAcross Southeast Asia it's ${Math.round(ft.insights.Full.underMilestone * 100)}%. Where did you run your best marathon?\n\n${FOLLOW}\n\n${TAGS} #sub4`);
  })(),
  'gender-gap-age': (() => {
    const gap = (a) => { const m = median(pool.Half.filter((x) => x[1] === 'M' && x[2] === a).map((x) => x[0])), w = median(pool.Half.filter((x) => x[1] === 'F' && x[2] === a).map((x) => x[0])); return [a, w / m - 1, m, w]; };
    const rows = ['U20', '20-29', '30-39', '40-49', '50-59', '60+'].map(gap);
    const max = Math.max(...rows.map((r) => r[1]));
    return story('gender', [
      [2.6, 'hook', { kicker: 'HALF MARATHON', lines: [['The gap between', false], ['men and women', false], ['is smallest at 60+.', true]] }],
      [5.8, 'bars', { title: "Women's gap to men", sub: "How much slower the typical women's half is, by age", rows: rows.map(([a, g], i) => ({ label: a === 'U20' ? 'Under 20' : a, value: g / max, show: `${Math.round(g * 100)}%`, hi: i === rows.length - 1 })), foot: 'Biggest under 20, smallest at 60+.' }],
    ], `The gap between men and women is smallest at 60+.\n\nHow much slower the typical women's half marathon is than the men's, by age:\n${rows.map(([a, g, m, w]) => `${a === 'U20' ? 'Under 20' : a}: ${Math.round(g * 100)}% (${hm(m)} vs ${hm(w)})`).join('\n')}\n\nBy their 60s, women are within ${Math.round(rows.at(-1)[1] * 100)}% of the men. Tag a runner in their 60s who's still racing.\n\nFrom ${n(pool.Half.length)} half marathon finishes. ${FOLLOW}\n\n${TAGS} #womenwhorun`);
  })(),
  'sunday-races': (() => {
    const sun = ents.filter((e) => new Date(e.core_facts.date + 'T00:00:00').getDay() === 0).length;
    const byM = {}; for (const e of ents) { const m = e.core_facts.date.slice(0, 7); byM[m] = (byM[m] ?? 0) + 1; }
    const thisMonth = new Date().toISOString().slice(0, 7);
    const months = Object.entries(byM).filter(([m]) => m > thisMonth).sort().slice(0, 5);
    const label = (ym) => new Date(ym + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }).replace(' ', " '");
    const max = Math.max(...months.map((m) => m[1]));
    return story('planning', [
      [2.6, 'hook', { kicker: `${ents.length} UPCOMING RACES`, lines: [[`${sun} are on`, false], ['a Sunday.', true]] }],
      [5.6, 'bars', { title: 'Races per month, coming up', sub: 'Half and full marathons we list', rows: months.map(([m, c]) => ({ label: label(m), value: c / max, show: String(c), hi: c === max })), foot: 'Plan now: the season thins out fast.' }],
    ], `${sun} of the ${ents.length} upcoming half and full marathons we list in Southeast Asia are on a Sunday.\n\nRaces per month:\n${months.map(([m, c]) => `${label(m)}: ${c}`).join('\n')}\n\nThe season peaks now and thins out after January, and some 2027 dates aren't announced yet. Which race is next for you?\n\nEvery race, with dates and official links: runsea.run (link in bio). ${FOLLOW}\n\n${TAGS}`);
  })(),
  'fastest-country-10k': (() => {
    const cs = ft.countries['10K'], sc = timeScale(cs.map((c) => c.median));
    return story('country rivalry', [
      [2.4, 'hook', { kicker: '10K', lines: [['Who runs the', false], ['fastest 10K?', true]] }],
      [5.4, 'bars', { title: 'Typical 10K finish', sub: 'Each race counts equally. Shorter is faster.', rows: cs.map((c, i) => ({ label: c.country, value: sc(c.median), show: hm(c.median), hi: i === 0 })), foot: `${cs[0].country} again.` }],
    ], `Which country runs the fastest 10K in Southeast Asia?\n\n${cs.map((c, i) => `${i + 1}. ${c.country}: ${hm(c.median)}`).join('\n')}\n\nTypical finish, each race counted equally (${cs.map((c) => c.races).reduce((a, b) => a + b, 0)} races, ${n(cs.reduce((a, c) => a + c.finishes, 0))} finishes). Agree?\n\n${FOLLOW}\n\n${TAGS} #10k`);
  })(),
  'first-and-last': (() => {
    const v = pool.Half.map((x) => x[0]).sort((a, b) => a - b), f1 = q(v, 0.01), l1 = q(v, 0.99);
    return story('everyone\'s race', [
      [2.6, 'hook', { kicker: 'SAME DISTANCE, SAME HEAT', lines: [['21.1 km.', false], ['Two very', false], ['different races.', true]] }],
      [4.8, 'pair', { title: 'Half marathon, Southeast Asia', a: { label: 'The fastest 1% finish under', value: f1, fmt: hm, hi: true }, b: { label: 'The last 1% finish after', value: l1, fmt: hm }, foot: 'Every one of them gets the medal.' }],
    ], `21.1 km. Two very different races.\n\nThe fastest 1% of half marathoners in Southeast Asia finish under ${hm(f1)}. The last 1% are still out there after ${hm(l1)}, more than ${(l1 / f1).toFixed(1)} times as long on their feet.\n\nSame distance, same medal. Respect to the back of the pack.\n\nFrom ${n(v.length)} half marathon finishes. ${FOLLOW}\n\n${TAGS}`);
  })(),
  'women-in-the-field': (() => {
    const rows = [['10K', ft.insights['10K'].womenShare], ['Half', ft.insights.Half.womenShare], ['Marathon', ft.insights.Full.womenShare]];
    return story('gender', [
      [2.4, 'hook', { kicker: 'THE LONGER THE RACE', lines: [['the fewer', false], ['women.', true]] }],
      [6.0, 'bars', { title: 'Women among finishers', sub: 'Southeast Asia, 2025–26', rows: rows.map(([l, s], i) => ({ label: l, value: s, show: `${Math.round(s * 100)}%`, hi: i === 0 })), foot: 'Stepping up next? Tag a friend.' }],
    ], `Women make up ${Math.round(rows[0][1] * 100)}% of 10K finishers in Southeast Asia, ${Math.round(rows[1][1] * 100)}% of half marathon finishers and just ${Math.round(rows[2][1] * 100)}% of marathon finishers. The longer the race, the fewer women on the start line.\n\nThinking about stepping up? Tag the friend you'd do it with.\n\n${FOLLOW}\n\n#womenwhorun #running #halfmarathon #marathon #southeastasia #runningsingapore #runsea`);
  })(),

  // ---- colour batch (30 Oct, second ten) --------------------------------------
  'older-at-longer': (() => {
    const forty = ['40-49', '50-59', '60+'];
    const rows = [['10K', ageShare('10K', forty)], ['Half marathon', ageShare('Half', forty)], ['Marathon', ageShare('Full', forty)]];
    const max = Math.max(...rows.map((r) => r[1]));
    return story('age', [
      [2.6, 'hook', { kicker: 'WHO RUNS WHAT', lines: [['The longer', false], ['the race,', false], ['the older', true], ['the runners.', true]] }],
      [5.6, 'bars', { title: 'Finishers aged 40 and over', sub: 'Share of each distance, Southeast Asia', rows: rows.map(([l, v], i) => ({ label: l, value: v / max, show: pct(v), hi: i === 2 })), foot: '4 in 10 marathoners are 40+.' }],
    ], `The longer the race, the older the runners.\n\nFinishers aged 40 and over in Southeast Asia:\n${rows.map(([l, v]) => `${l}: ${pct(v)}`).join('\n')}\n\nAt the marathon distance, ${pct(ageShare('Full', ['40-49']))} of finishers are in their 40s, against ${pct(ageShare('10K', ['40-49']))} in the 10K. Tag the 40-something who just signed up for a marathon.\n\nFrom finishers with a published age group. ${FOLLOW}\n\n${TAGS}`, 'sunset');
  })(),
  'race-morning-weather': (() => {
    const w = uniqBy(glance(/^Weather at the .*start/i).map((x) => { const t = x.value.match(/(\d+)°C/), dp = x.value.match(/dew point (\d+)°C/), h = x.value.match(/(\d+)% humidity/); return { ...x, t: t && +t[1], dp: dp && +dp[1], h: h && +h[1] }; }).filter((x) => x.t != null && x.dp != null), (x) => clean(x.e.name));
    const hot = [...w].sort((a, b) => b.dp - a.dp || b.t - a.t).slice(0, 4), cool = [...w].sort((a, b) => a.dp - b.dp || a.t - b.t).slice(0, 4);
    return story('weather', [
      [2.4, 'hook', { kicker: 'RACE-MORNING WEATHER', lines: [['Same dawn.', false], ['Different', false], ['planet.', true]] }],
      [4.4, 'list', { title: 'Stickiest race mornings', sub: 'Temperature at the start, from airport records', items: hot.map((x, i) => [clean(x.e.name), `${x.t}°C`, i === 0, `${x.e.core_facts.country} · ${x.h}% humidity`]) }],
      [4.4, 'list', { title: 'Coolest race mornings', sub: 'Temperature at the start, from airport records', items: cool.map((x, i) => [clean(x.e.name), `${x.t}°C`, i === 0, `${x.e.core_facts.country} · dew point ${x.dp}°C`]), foot: 'Hot or cool: which do you race better in?' }],
    ], `Same dawn, very different race.\n\nStickiest race mornings we've recorded:\n${hot.map((x) => `${clean(x.e.name)}: ${x.t}°C, ${x.h}% humidity`).join('\n')}\n\nCoolest:\n${cool.map((x) => `${clean(x.e.name)}: ${x.t}°C`).join('\n')}\n\nTemperatures at the start, from the nearest airport's records, for races we've reviewed. Hot or cool: which do you race better in?\n\n${FOLLOW}\n\n${TAGS} #runninginheat`, 'fire');
  })(),
  'beach-races': (() => {
    const picks = ['langkawi-international-half-marathon-2026', 'kathu-marathon-2026', 'sanur-bali-international-half-marathon-2027', 'danang-international-marathon-2027', 'boracay-island-360-marathon-2027', 'laguna-phuket-marathon-2027'].map(bySlug).filter((e) => e && ['active', 'needs_review'].includes(e.status) && !e.core_facts.event_status);
    return story('travel', [
      [2.4, 'hook', { kicker: 'RACE-CATION', lines: [['Race on Sunday.', false], ['Beach by lunch.', true]] }],
      [6.4, 'list', { title: 'Half and full marathons by the sea', items: picks.map((e) => [clean(e.name), day(e.core_facts.date), false, `${e.core_facts.city.split(',')[0]}, ${e.core_facts.country}`]), foot: 'Which beach are you racing to?', step: 0.55 }],
    ], `Race on Sunday. Beach by lunch.\n\n${picks.map((e) => `${day(e.core_facts.date)} ${e.core_facts.date.slice(0, 4)}: ${clean(e.name)} (${e.core_facts.city.split(',')[0]}, ${e.core_facts.country})`).join('\n')}\n\nSave this for your next holiday and tag who you're going with. Dates and official links at runsea.run (link in bio)\n\n${FOLLOW}\n\n${TAGS} #racecation #beach`, 'lagoon');
  })(),
  'tier-challenge': (() => {
    const tq = (g) => ft.tables.Half.all[g].all;
    const tiers = [['Elite', 1], ['Podium', 5], ['Front pack', 10], ['Strong', 25], ['Steady', 50]];
    return story('challenge', [
      [2.6, 'hook', { kicker: 'HALF MARATHON', lines: [['What tier', false], ['is your time?', true]], sub: 'Comment your time below.' }],
      [6.0, 'list', { title: 'Finish under this to make the tier', sub: 'Men / women, all ages, Southeast Asia', items: tiers.map(([nm, p], i) => [nm, `${hm(tq('M')[p])} / ${hm(tq('F')[p])}`, i === 2, `Top ${p}%`]), foot: 'Drop your time and tier in the comments.', step: 0.5 }],
    ], `What tier is your half marathon time?\n\nFinish under this (men / women, all ages, Southeast Asia):\n${tiers.map(([nm, p]) => `${nm} (top ${p}%): ${hm(tq('M')[p])} / ${hm(tq('F')[p])}`).join('\n')}\n\nDrop your time and your tier in the comments. Want it for your age group? runsea.run/tools (link in bio)\n\n${FOLLOW}\n\n${TAGS}`, 'neon');
  })(),
  'generous-cutoffs': (() => {
    const cuts = glance(/^Cut-offs/i).map((x) => { const yr = [...x.value.matchAll(/20\d\d:\s*(\d+)\s*hours?(?:\s*(\d+))?/g)].at(-1); const m = yr ?? x.value.match(/[Mm]arathon[^,;.]*?(\d+(?:\.\d+)?)\s*hours?(?:\s*(\d+))?/); return { ...x, hrs: m ? +m[1] + (m[2] ? +m[2] / 60 : 0) : null }; }).filter((x) => x.hrs && !/half/i.test(x.value.slice(0, x.value.search(/\d/))));
    const top = uniqBy(cuts.sort((a, b) => b.hrs - a.hrs), (x) => clean(x.e.name)).slice(0, 6);
    const fmt = (h) => `${Math.floor(h)}h${h % 1 ? ` ${Math.round((h % 1) * 60)}` : ''}`;
    return story('first marathon', [
      [2.4, 'hook', { kicker: 'FIRST MARATHON?', lines: [['These give you', false], ['the most time.', true]] }],
      [6.2, 'list', { title: 'Most generous marathon cut-offs', sub: 'From the races we review', items: top.map((x, i) => [clean(x.e.name), fmt(x.hrs), i === 0, x.e.core_facts.country]), foot: 'Check the latest rules before you enter.', step: 0.5 }],
    ], `First marathon and worried about the cut-off? These give you the most time:\n\n${top.map((x) => `${fmt(x.hrs)}: ${clean(x.e.name)} (${x.e.core_facts.country})`).join('\n')}\n\nSave this, and check each race's latest rules before you enter. Cut-offs for every race we review at runsea.run (link in bio)\n\n${FOLLOW}\n\n${TAGS} #firstmarathon`, 'mint');
  })(),
  'fastest-field-country': (() => {
    // Fastest half marathon crowd per country; MILO legs left out (they're qualifiers for the national finals).
    const best = {};
    for (const r of raceRows.filter((r) => r.k === 'Half' && r.times.length >= 300 && !/MILO/i.test(r.name))) {
      const med = median(r.times.map((x) => x[0]));
      if (!best[r.country] || med < best[r.country].med) best[r.country] = { ...r, med };
    }
    const list = Object.values(best).sort((a, b) => a.med - b.med);
    return story('race choice', [
      [2.4, 'hook', { kicker: 'HALF MARATHON', lines: [['The fastest', false], ['crowd in every', false], ['country.', true]] }],
      [6.0, 'list', { title: 'Fastest half marathon field', sub: 'Typical finish at each country\u2019s quickest race', items: list.map((r, i) => [clean(r.name), hm(r.med), i === 0, r.country]), foot: 'Want company at your pace? Pick your race.', step: 0.5 }],
    ], `The fastest half marathon crowd in every country, by typical finish time:\n\n${list.map((r) => `${r.country}: ${clean(r.name)}, ${hm(r.med)}`).join('\n')}\n\nFrom races with 300+ half marathon finishers in the latest results we hold (MILO legs left out: they're qualifiers). Ran one of these?\n\n${FOLLOW}\n\n${TAGS} #thailandrunning #vietnamrunners`, 'royal');
  })(),
  'women-beat-men': (() => {
    const beat = (k) => { const M = pool[k].filter((x) => x[1] === 'M').map((x) => x[0]), F = pool[k].filter((x) => x[1] === 'F').map((x) => x[0]).sort((a, b) => a - b); const t = q(F, 0.1); return [M.filter((m) => m > t).length / M.length, t]; };
    const rows = [['Half marathon', ...beat('Half')], ['Marathon', ...beat('Full')], ['10K', ...beat('10K')]];
    return story('gender', [
      [2.6, 'hook', { kicker: 'HALF MARATHON', lines: [['The top 10%', false], ['of women beat', false], ['3 in 4 men.', true]] }],
      [5.6, 'bars', { title: 'Men beaten by the top 10% of women', sub: 'Southeast Asia, by distance', rows: rows.map(([l, v], i) => ({ label: l, value: v, show: pct(v), hi: i === 1 })), foot: 'Tag the woman who passed you.' }],
    ], `The top 10% of women beat ${pct(rows[0][1])} of men in Southeast Asian half marathons.\n\n${rows.map(([l, v, t]) => `${l}: top-10% women finish under ${hm(t)}, ahead of ${pct(v)} of men`).join('\n')}\n\nTag the woman who passed you in the last kilometre.\n\nFrom ${n(pool.Half.length + pool.Full.length + pool['10K'].length)} finishes. ${FOLLOW}\n\n${TAGS} #womenwhorun`, 'grape');
  })(),
  'biggest-races': (() => {
    const tot = {};
    for (const r of raceRows) { tot[r.slug] ??= { name: clean(r.name), country: r.country, n: 0 }; tot[r.slug].n += r.times.length; }
    const top = Object.values(tot).sort((a, b) => b.n - a.n).slice(0, 5);
    return story('race pride', [
      [2.6, 'hook', { kicker: 'SOUTHEAST ASIA', lines: [['One race had', false], [`${n(top[0].n)}`, true], ['finishers.', false]] }],
      [5.8, 'bars', { title: 'Biggest fields in our results', sub: 'Finishers in the 10K, half and full, latest edition', rows: top.map((r, i) => ({ label: `${r.name} (${r.country})`, value: r.n / top[0].n, show: n(r.n), hi: i === 0 })), foot: 'Which have you run?' }],
    ], `The biggest race fields in the results we hold across Southeast Asia (10K, half and full marathon finishers, latest edition):\n\n${top.map((r, i) => `${i + 1}. ${r.name}, ${r.country}: ${n(r.n)}`).join('\n')}\n\nWhich of these have you run?\n\n${FOLLOW}\n\n${TAGS}`, 'ocean');
  })(),
  'women-10k-country': (() => {
    const share = (k) => { const by = {}; for (const r of raceRows.filter((r) => r.k === k)) { by[r.country] ??= [0, 0]; for (const x of r.times) { if (x[1] === 'F') by[r.country][0]++; if (x[1] === 'M' || x[1] === 'F') by[r.country][1]++; } } return Object.entries(by).filter(([, [, t]]) => t >= 3000).map(([c, [f, t]]) => [c, f / t]).sort((a, b) => b[1] - a[1]); };
    const ten = share('10K'), hf = share('Half');
    return story('gender', [
      [2.6, 'hook', { kicker: `${ten[0][0].toUpperCase()}, 10K`, lines: [['Women', false], ['outnumber', true], ['men.', false]] }],
      [5.6, 'bars', { title: 'Women among 10K finishers', sub: 'By country', rows: ten.map(([c, v], i) => ({ label: c, value: v, show: pct(v), hi: i === 0 })), foot: 'Half marathons next?' }],
    ], `In the ${ten[0][0] === 'Philippines' ? 'Philippines' : ten[0][0]}, women outnumber men in the 10K: ${pct(ten[0][1])} of finishers.\n\nWomen among 10K finishers:\n${ten.map(([c, v]) => `${c}: ${pct(v)}`).join('\n')}\n\nIn the half marathon the share drops to ${hf.map(([c, v]) => `${pct(v)} (${c})`).slice(0, 3).join(', ')}. Ready to step up? Tag your running partner.\n\n${FOLLOW}\n\n${TAGS} #womenwhorun`, 'peach');
  })(),
  'win-your-age-group': (() => {
    const wins = (g, a) => raceRows.filter((r) => r.k === 'Half').map((r) => r.times.filter((x) => x[1] === g && x[2] === a).map((x) => x[0]).sort((p, z) => p - z)).filter((v) => v.length >= 50).map((v) => v[0]);
    const rows = [];
    for (const [g, w] of [['M', 'Men'], ['F', 'Women']]) for (const a of ['20-29', '30-39', '40-49', '50-59']) { const v = wins(g, a); if (v.length >= 10) rows.push([`${w} ${a}`, median(v), v.length]); }
    return story('aspiration', [
      [2.6, 'hook', { kicker: 'HALF MARATHON', lines: [['What does it', false], ['take to win', false], ['your age group?', true]] }],
      [6.4, 'list', { title: 'Typical winning time', sub: 'Median age-group winner across races', items: rows.map(([l, t, c], i) => [l, hm(t), l === 'Men 40-49' || l === 'Women 40-49', `${c} races`]), foot: 'Closer than you thought?', step: 0.45 }],
    ], `What does it take to win your age group at a Southeast Asian half marathon?\n\nTypical winning time:\n${rows.map(([l, t]) => `${l}: ${hm(t)}`).join('\n')}\n\nThe median of each race's age-group winner, across races where the group had 50+ finishers. Closer than you thought?\n\n${FOLLOW}\n\n${TAGS}`, 'citrus');
  })(),
};

// ---- render -------------------------------------------------------------------------
fs.mkdirSync(OUT, { recursive: true });
const caps = [];
for (const name of names) {
  const st = STORIES[name];
  if (!st) { console.error(`unknown story ${name}`); continue; }
  // PREVIEW=1.5,6 renders stills at those seconds instead of the video.
  if (process.env.PREVIEW) {
    for (const sec of process.env.PREVIEW.split(',').map(Number)) await sharp(Buffer.from(st.draw(sec))).png().toFile(path.join(OUT, `${name}@${sec}.png`));
    continue;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-'));
  const frames = Math.round(st.dur * FPS);
  for (let i = 0; i < frames; i++) await sharp(Buffer.from(st.draw(i / FPS))).png({ compressionLevel: 1 }).toFile(path.join(tmp, `${String(i).padStart(4, '0')}.png`));
  const out = path.join(OUT, `${name}.mp4`);
  execFileSync(FFMPEG, ['-y', '-framerate', String(FPS), '-i', path.join(tmp, '%04d.png'), '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
    '-shortest', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out], { stdio: ['ignore', 'ignore', 'pipe'] });
  fs.rmSync(tmp, { recursive: true, force: true });
  caps.push(`## ${name} (topic: ${st.topic}, ${st.dur.toFixed(1)}s)\n\n${st.caption}\n`);
  console.log(`${name}: ${st.dur.toFixed(1)}s -> ${out}`);
}
// Merge into captions.md so re-rendering some stories keeps the others' captions.
const capFile = path.join(OUT, 'captions.md');
const old = fs.existsSync(capFile) ? fs.readFileSync(capFile, 'utf8').split('\n---\n\n') : [];
const key = (c) => c.match(/^## (\S+)/)?.[1];
const merged = new Map(old.filter(Boolean).map((c) => [key(c), c]));
for (const c of caps) merged.set(key(c), c);
if (caps.length) fs.writeFileSync(capFile, [...merged.values()].join('\n---\n\n'));
