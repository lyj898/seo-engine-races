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

// ---- easing and drawing helpers ---------------------------------------------
const clamp = (x) => Math.max(0, Math.min(1, x));
const ease = (x) => 1 - (1 - clamp(x)) ** 3;
const at = (s, start, dur = 0.5) => ease((s - start) / dur);
// Shrinks the font until the line fits maxW (average glyph widths for Segoe UI).
const fit = (str, size, maxW, heavy, ls) => {
  const caps = /[A-Z]/.test(str) && str === String(str).toUpperCase();
  return Math.min(size, maxW / (String(str).length * ((heavy ? 0.6 : 0.54) + (caps ? 0.1 : 0) + ls / size)));
};
const text = (str, { x = 90, y, size: want = 64, fill = CREAM, weight = 800, heavy = false, anchor = 'start', p = 1, ls = 0, maxW = W - 180 }) => {
  const size = fit(str, want, maxW, heavy, ls);
  return `<text x="${x}" y="${(y + (1 - p) * 40).toFixed(1)}" text-anchor="${anchor}" opacity="${p.toFixed(3)}" font-family="${heavy ? HVY : F}" font-weight="${heavy ? 900 : weight}" font-size="${size}" letter-spacing="${ls}" fill="${fill}">${esc(str)}</text>`;
};
const frame = (body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs><filter id="glow"><feGaussianBlur stdDeviation="12" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <radialGradient id="halo" cx="0.8" cy="0.15" r="0.7"><stop offset="0" stop-color="${LIME}" stop-opacity="0.16"/><stop offset="1" stop-color="${LIME}" stop-opacity="0"/></radialGradient></defs>
  <rect width="${W}" height="${H}" fill="${INK}"/><rect width="${W}" height="${H}" fill="url(#halo)"/>
  <text x="90" y="170" font-family="${F}" font-weight="800" font-size="32" letter-spacing="7" fill="${LIME}">RUN SEA</text>
  ${body}
  <text x="90" y="${H - 120}" font-family="${F}" font-weight="800" font-size="34" fill="${CREAM}" opacity="0.8">@runsea.run</text>
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
    ${lines.map(([str, hi], i) => text(str, { y: 900 + i * size * 1.15, size, heavy: true, fill: hi ? LIME : CREAM, p: at(s, 0.35 + i * 0.35) })).join('')}
    ${sub ? text(sub, { y: 900 + lines.length * size * 1.15 + 30, size: 46, weight: 600, fill: MUTED, p: at(s, 0.5 + lines.length * 0.35) }) : ''}`;
  },
  // Horizontal bars that grow; `rows`: { label, value (0-1 of the bar), show (final text), hi }.
  bars: (s, { title, sub, rows, foot }) => {
    // Rows share the space between the subtitle and the closing line.
    const top = 620, bottom = 1580, gap = Math.min(300, (bottom - top) / rows.length), bh = Math.min(100, gap - 90), max = 900;
    return `${text(title, { y: 380, size: 66, heavy: true, p: at(s, 0) })}
      ${sub ? text(sub, { y: 455, size: 40, weight: 600, fill: MUTED, p: at(s, 0.2) }) : ''}
      ${rows.map((r, i) => {
        const p = at(s, 0.3 + i * 0.45, 1.0), y = top + i * gap, w = Math.max(1, max * r.value * p), vs = Math.min(62, bh * 0.62);
        // Value label after the bar, or inside its end in dark type when there's no room.
        const inside = 90 + max * r.value + 24 + String(r.show).length * vs * 0.6 > W - 60;
        return `${text(r.label, { y, size: Math.min(52, gap * 0.26), weight: 800, p: at(s, 0.1 + i * 0.45) })}
          <rect x="90" y="${y + 30}" width="${max}" height="${bh}" rx="18" fill="#ffffff" opacity="0.08"/>
          <rect x="90" y="${y + 30}" width="${w.toFixed(1)}" height="${bh}" rx="18" fill="${r.hi ? LIME : '#8a9a52'}" ${r.hi ? 'filter="url(#glow)"' : ''}/>
          ${inside ? text(r.show, { x: 70 + w, anchor: 'end', y: y + 30 + bh * 0.72, size: vs, heavy: true, fill: INK, p })
            : text(r.show, { x: 110 + w, y: y + 30 + bh * 0.72, size: vs, heavy: true, p })}`;
      }).join('')}
      ${foot ? text(foot, { y: 1700, size: 46, weight: 700, fill: LIME, p: at(s, 0.6 + rows.length * 0.45) }) : ''}`;
  },
  // Two big numbers that count up, one above the other.
  pair: (s, { title, a, b, foot }) => {
    const row = (r, y, i) => {
      const p = at(s, 0.4 + i * 0.9, 1.1);
      return `${text(r.label, { y, size: 56, weight: 800, fill: r.hi ? LIME : CREAM, p: at(s, 0.2 + i * 0.9) })}
        ${text(r.fmt ? r.fmt(r.value * p) : n(r.value * p), { y: y + 190, size: 200, heavy: true, fill: r.hi ? LIME : CREAM, p: Math.min(1, p * 3) })}
        ${r.unit ? text(r.unit, { y: y + 260, size: 42, weight: 600, fill: MUTED, p: at(s, 0.6 + i * 0.9) }) : ''}`;
    };
    return `${text(title, { y: 380, size: 66, heavy: true, p: at(s, 0) })}${row(a, 620, 0)}${row(b, 1060, 1)}
      ${foot ? text(foot, { y: 1560, size: 48, weight: 700, fill: LIME, p: at(s, 2.4) }) : ''}`;
  },
  // A ranked list that appears line by line.
  list: (s, { title, sub, items, foot }) => `${text(title, { y: 380, size: 66, heavy: true, p: at(s, 0) })}
    ${sub ? text(sub, { y: 455, size: 40, weight: 600, fill: MUTED, p: at(s, 0.2) }) : ''}
    ${items.map(([l, r, hi], i) => `${text(l, { y: 640 + i * 190, size: 60, weight: 800, fill: hi ? LIME : CREAM, p: at(s, 0.3 + i * 0.4) })}
      ${text(r, { x: W - 90, anchor: 'end', y: 640 + i * 190, size: 96, heavy: true, fill: hi ? LIME : CREAM, p: at(s, 0.45 + i * 0.4) })}`).join('')}
    ${foot ? text(foot, { y: 1660, size: 46, weight: 700, fill: LIME, p: at(s, 0.6 + items.length * 0.4) }) : ''}`,
  follow: (s, { line = 'A new race stat every day.' }) => `${text('Follow', { y: 760, size: 150, heavy: true, fill: LIME, p: at(s, 0) })}
    ${text('@runsea.run', { y: 900, size: 96, heavy: true, p: at(s, 0) })}
    ${text(line, { y: 1060, size: 54, weight: 600, p: at(s, 0.35) })}
    ${text('Rank your own time: runsea.run/tools', { y: 1170, size: 42, weight: 600, fill: MUTED, p: at(s, 0.7) })}`,
};
/** Story from [duration, kind, props] steps; the follow card is appended. */
const story = (topic, steps, caption) => {
  const scenes = []; let t = 0;
  for (const [dur, kind, props] of [...steps, [2.6, 'follow', {}]]) { scenes.push({ t0: t, t1: t + dur, kind, props }); t += dur; }
  return { topic, dur: t, scenes, caption, draw(time) { const sc = scenes.find((x) => time < x.t1) ?? scenes.at(-1); return frame(KINDS[sc.kind](time - sc.t0, sc.props)); } };
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
    ], `The gap between men and women is smallest at 60+.\n\nHow much slower the typical women's half marathon is than the men's, by age:\n${rows.map(([a, g, m, w]) => `${a === 'U20' ? 'Under 20' : a}: ${Math.round(g * 100)}% (${hm(m)} vs ${hm(w)})`).join('\n')}\n\nBy their 60s, women are within ${Math.round(rows.at(-1)[1] * 100)}% of the men. Tag a runner who's getting faster with age.\n\nFrom ${n(pool.Half.length)} half marathon finishes. ${FOLLOW}\n\n${TAGS} #womenwhorun`);
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
