#!/usr/bin/env node
// Social posts for the week of 27 Oct 2026: a Lab stat carousel, the haze
// season in numbers, and newly announced 2027 races. Numbers come from the
// site's own data at run time. Output (PNGs + captions.md) goes to
// OneDrive Documents\runsea-social\2026-10-27, outside the repo.
//
//   node scripts/social/week-2026-10-27.js
import fs from 'node:fs';
import path from 'node:path';
import { loadEntities, stripMeta, isReviewableEntity } from '../../src/lib/data.js';
import { loadFinishTimes } from '../../src/lib/finishTimes.js';
import { W, LIME, TEXT, MUTED, LINE, FONT, HEAVY, esc, text, frame, curve, render } from './cards.js';

const OUT = path.join(process.env.USERPROFILE ?? '.', 'OneDrive', 'Documents', 'runsea-social', '2026-10-27');
const hm = (s) => `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}`;
const n = (x) => x.toLocaleString('en-US');
const short = (name) => name.replace(/\s*(Powered by JomRun®?|presented by.*)$/i, '').replace(/\b20(26|27)\b/g, '').replace(/\s+–\s+Malaysia$/, ' Malaysia').replace(/^\s*2026\s*/, '').replace(/\s{2,}/g, ' ').trim();
const dist = (ds) => [...ds].map(Number).sort((a, b) => b - a).filter((d) => d >= 10).map((d) => (d >= 42 ? 'Full' : d >= 21 ? 'Half' : `${d}K`)).join(' · ');
const place = (e) => { const c = e.core_facts.city.split(',')[0].trim(); return c === e.core_facts.country ? c : `${c}, ${e.core_facts.country}`; };
const dayLabel = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

const entities = loadEntities().map(stripMeta).filter((e) => ['active', 'needs_review'].includes(e.status) && !e.core_facts?.event_status);
const ft = loadFinishTimes();
const half = ft.insights.Half;
const captions = [];

// ---- Post 1 (Tue): the two-hour half -------------------------------------
{
  const pct = Math.round(half.underMilestone * 100);
  const peak = half.bins.reduce((m, b) => (b.n > m.n ? b : m), half.bins[0]);
  const fastAges = half.ages.filter((a) => a.men && a.men - Math.min(...half.ages.filter((x) => x.men).map((x) => x.men)) <= 60).map((a) => `${a.band.slice(0, 2)}s`);
  const P = 5;
  const s1 = frame(`
    <text x="80" y="520" font-family="${HEAVY}" font-weight="900" font-size="260" fill="${LIME}">${pct}%</text>
    ${text(`of half marathoners in Southeast Asia break two hours.`, { y: 640, size: 64, weight: 'heavy' }).svg}
    ${text(`From ${n(half.finishes)} finishes at ${half.races} races.`, { y: 900, size: 36, color: MUTED }).svg}`, { tag: 'The Lab', page: 1, pages: P });
  const h2 = text('Where half marathons finish', { y: 260, size: 64, weight: 'heavy' });
  const s2 = frame(`
    ${h2.svg}
    ${text(`The busiest 10 minutes: ${hm(peak.lo)} to ${hm(peak.lo + 600)}. Lime = under two hours.`, { y: 260 + h2.height + 10, size: 34, color: MUTED }).svg}
    ${curve({ x: 80, y: 500, w: W - 160, h: 520, bins: half.bins, limeIf: (b) => b.lo < 7200 })}
    <text x="80" y="1080" font-family="${FONT}" font-size="30" fill="${MUTED}">${hm(half.bins[0].lo)}</text>
    <text x="${80 + ((7200 - half.bins[0].lo) / (half.bins.at(-1).lo + 600 - half.bins[0].lo)) * (W - 160)}" y="1080" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="30" fill="${LIME}">2:00</text>
    <text x="${W - 80}" y="1080" text-anchor="end" font-family="${FONT}" font-size="30" fill="${MUTED}">${hm(half.bins.at(-1).lo)}+</text>`, { tag: 'The Lab', page: 2, pages: P });
  const row = (y, label, m, f, hi) => `
    <text x="80" y="${y}" font-family="${FONT}" font-weight="600" font-size="44" fill="${TEXT}">${label}</text>
    <text x="620" y="${y}" text-anchor="middle" font-family="${HEAVY}" font-weight="900" font-size="64" fill="${hi ? LIME : TEXT}">${m}</text>
    <text x="890" y="${y}" text-anchor="middle" font-family="${HEAVY}" font-weight="900" font-size="64" fill="${hi ? LIME : TEXT}">${f}</text>
    <line x1="80" x2="${W - 80}" y1="${y + 50}" y2="${y + 50}" stroke="${LINE}" stroke-width="2"/>`;
  const s3 = frame(`
    ${text('What it takes', { y: 260, size: 72, weight: 'heavy' }).svg}
    ${text('The half marathon time you need to beat most of the field.', { y: 350, size: 34, color: MUTED }).svg}
    <text x="620" y="520" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="30" letter-spacing="3" fill="${MUTED}">MEN</text>
    <text x="890" y="520" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="30" letter-spacing="3" fill="${MUTED}">WOMEN</text>
    ${row(650, 'Top 1%', hm(half.men.top1), hm(half.women.top1), true)}
    ${row(810, 'Top 10%', hm(half.men.top10), hm(half.women.top10))}
    ${row(970, 'Typical', hm(half.men.median), hm(half.women.median))}`, { tag: 'The Lab', page: 3, pages: P });
  const ageRows = half.ages.map((a, i) => {
    const y = 560 + i * 105;
    const fast = fastAges.includes(`${a.band.slice(0, 2)}s`);
    return `<text x="80" y="${y}" font-family="${FONT}" font-weight="700" font-size="44" fill="${fast ? LIME : TEXT}">${a.band === 'U20' ? 'Under 20' : a.band}</text>
      <text x="620" y="${y}" text-anchor="middle" font-family="${FONT}" font-weight="600" font-size="44" fill="${fast ? LIME : TEXT}">${a.men ? hm(a.men) : '–'}</text>
      <text x="890" y="${y}" text-anchor="middle" font-family="${FONT}" font-weight="600" font-size="44" fill="${fast ? LIME : TEXT}">${a.women ? hm(a.women) : '–'}</text>`;
  }).join('');
  const s4 = frame(`
    ${text(`Runners in their ${fastAges.join(' and ')} run the fastest halves`, { y: 250, size: 62, weight: 'heavy' }).svg}
    <text x="620" y="470" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="30" letter-spacing="3" fill="${MUTED}">MEN</text>
    <text x="890" y="470" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="30" letter-spacing="3" fill="${MUTED}">WOMEN</text>
    ${ageRows}
    ${text('Typical time by age. Older runners who still race tend to be the committed ones.', { y: 1180, size: 30, color: MUTED }).svg}`, { tag: 'The Lab', page: 4, pages: P });
  const s5 = frame(`
    ${text('How do you stack up?', { y: 420, size: 96, weight: 'heavy' }).svg}
    ${text('Put in your race time. See your rank against runners of your gender and age, and your tier from Finisher to Elite.', { y: 700, size: 42 }).svg}
    <text x="80" y="1020" font-family="${HEAVY}" font-weight="900" font-size="72" fill="${LIME}">runsea.run/tools</text>
    ${text('Free. Half, marathon and 10K.', { y: 1090, size: 34, color: MUTED }).svg}`, { tag: 'The Lab', page: 5, pages: P });
  const files = await render([s1, s2, s3, s4, s5], OUT, '1-lab-two-hour-half');
  captions.push({
    title: 'Post 1 (Tue 27 Oct): Only ' + pct + '% break two hours',
    files,
    caption: `Only ${pct}% of half marathoners in Southeast Asia finish under two hours.\n\nWe crunched ${n(half.finishes)} half marathon finishes from ${half.races} races across the region. The busiest finish window is ${hm(peak.lo)} to ${hm(peak.lo + 600)}. Top 10% takes ${hm(half.men.top10)} for men and ${hm(half.women.top10)} for women. And runners in their ${fastAges.join(' and ')} post the fastest typical times.\n\nWhere does your time rank? Free at runsea.run/tools (link in bio)\n\n#halfmarathon #running #runningsingapore #runningmalaysia #larimalaysia #runnersph #vietnamrunners #thailandrunning #southeastasia #runsea`,
  });
}

// ---- Post 2 (Thu): haze season by numbers (from /race-cancellations/) -----
{
  const all = loadEntities().map(stripMeta).filter(isReviewableEntity);
  const halted = all.filter((e) => e.core_facts?.event_status && /^\d{4}-\d{2}-\d{2}$/.test(e.core_facts.date)).sort((a, b) => a.core_facts.date.localeCompare(b.core_facts.date));
  const isHaze = (note = '') => /haze|air quality|air pollutant|jerebu/i.test(note);
  const haze = halted.filter((e) => isHaze(e.core_facts.event_status_note));
  const virtual = halted.filter((e) => /virtual run/i.test(e.core_facts.event_status_note ?? '')).length;
  const postponed = halted.filter((e) => e.core_facts.event_status === 'postponed').length;
  const shortened = all.filter((e) => e.core_facts?.race_day_change && !e.core_facts.event_status).length;
  const P = 5;
  const tile = (x, y, big, label) => `<rect x="${x}" y="${y}" width="440" height="250" rx="28" fill="#ffffff0d"/>
    <text x="${x + 40}" y="${y + 130}" font-family="${HEAVY}" font-weight="900" font-size="110" fill="${LIME}">${big}</text>
    <text x="${x + 40}" y="${y + 200}" font-family="${FONT}" font-weight="600" font-size="34" fill="${TEXT}">${esc(label)}</text>`;
  const s1 = frame(`
    <text x="80" y="560" font-family="${HEAVY}" font-weight="900" font-size="300" fill="${LIME}">${halted.length}</text>
    ${text('races called off in Southeast Asia since September', { y: 690, size: 72, weight: 'heavy' }).svg}
    ${text(`${haze.length} of them because of haze or unhealthy air.`, { y: 1000, size: 40, color: MUTED }).svg}`, { tag: 'Haze season', page: 1, pages: P });
  const s2 = frame(`
    ${text('The 2026 haze season in numbers', { y: 260, size: 66, weight: 'heavy' }).svg}
    ${tile(80, 440, halted.length, 'races called off')}
    ${tile(560, 440, haze.length, 'for haze or air quality')}
    ${tile(80, 730, virtual, 'turned into virtual runs')}
    ${tile(560, 730, postponed, 'postponed')}
    ${text(`Plus ${shortened} race shortened on the day. Half and full marathons on our calendar only.`, { y: 1080, size: 32, color: MUTED }).svg}`, { tag: 'Haze season', page: 2, pages: P });
  let y = 300;
  const rows = haze.map((e) => {
    const r = `<text x="80" y="${y}" font-family="${FONT}" font-weight="700" font-size="30" letter-spacing="2" fill="${LIME}">${esc(dayLabel(e.core_facts.date).toUpperCase())}</text>
      <text x="330" y="${y}" font-family="${FONT}" font-weight="700" font-size="34" fill="${TEXT}">${esc(short(e.name.replace(/\s*\(.*\)\s*$/, '')))}</text>`;
    y += 86;
    return r;
  }).join('');
  const s3 = frame(`${text('Called off for haze', { y: 220, size: 60, weight: 'heavy' }).svg}${rows}`, { tag: 'Haze season', page: 3, pages: P });
  const tips = [
    ['Watch the night before', 'Most calls came late, some the evening before. Follow the organiser’s page in race week.'],
    ['Know the reading', 'API in Malaysia, PSI and PM2.5 in Singapore. Check it yourself on race morning.'],
    ['Book flexible', 'Refundable flights and hotels if you are travelling to race in the dry season.'],
    ['Read the small print', 'Refund, transfer and virtual-run rules differ. Check them before you enter.'],
  ];
  let ty = 360;
  const tipSvg = tips.map(([h, b]) => {
    const head = `<text x="80" y="${ty}" font-family="${HEAVY}" font-weight="900" font-size="46" fill="${LIME}">${esc(h)}</text>`;
    const body = text(b, { y: ty + 60, size: 34 });
    ty += 60 + body.height + 70;
    return head + body.svg;
  }).join('');
  const s4 = frame(`${text('Racing in haze season?', { y: 230, size: 66, weight: 'heavy' }).svg}${tipSvg}`, { tag: 'Haze season', page: 4, pages: P });
  const h5 = text('Every race called off this year', { y: 380, size: 88, weight: 'heavy' });
  const s5 = frame(`
    ${h5.svg}
    ${text('With the organiser’s reason and a source for each. Updated as it happens.', { y: 380 + h5.height + 50, size: 42 }).svg}
    <text x="80" y="980" font-family="${HEAVY}" font-weight="900" font-size="60" fill="${LIME}">runsea.run/</text>
    <text x="80" y="1060" font-family="${HEAVY}" font-weight="900" font-size="60" fill="${LIME}">race-cancellations</text>`, { tag: 'Haze season', page: 5, pages: P });
  const files = await render([s1, s2, s3, s4, s5], OUT, '2-haze-season');
  captions.push({
    title: `Post 2 (Thu 29 Oct): ${halted.length} races called off this haze season`,
    files,
    caption: `${halted.length} half and full marathons in Southeast Asia have been called off since September, ${haze.length} of them because of haze or unhealthy air. ${virtual} became virtual runs, ${postponed} were postponed, and ${shortened} went ahead shortened.\n\nIf you're racing in the dry season: follow your organiser in race week, check the API or PSI yourself, and book refundable travel.\n\nEvery cancellation, with the reason and a source: runsea.run/race-cancellations (link in bio)\n\n#haze #jerebu #running #halfmarathon #runningmalaysia #larimalaysia #runningsingapore #sghaze #runsea`,
  });
}

// ---- Post 3 (Sat): newly announced 2027 races ------------------------------
{
  const slugs = ['pekan-rabu-half-marathon-2027', 'pocari-sweat-run-carnival-2027', 'pse-bull-run-2027', 'frontliners-run-2027', 'chaiyaphum-marathon-2027', '2xu-compression-run-2027', 'cybercity-half-marathon-2027-powered-by-jomrun', 'iskandar-city-half-marathon-2027-powered-by-jomrun', 'kuching-half-marathon-heritage-run-2027', 'forest-run-sentosa-2027'];
  const races = slugs.map((s) => entities.find((e) => e.slug === s)).filter(Boolean).sort((a, b) => a.core_facts.date.localeCompare(b.core_facts.date));
  const pages = [races.slice(0, 4), races.slice(4, 7), races.slice(7)];
  const P = pages.length + 2;
  const slides = [frame(`
    ${text('Just announced', { y: 460, size: 64, weight: 'bold', color: LIME }).svg}
    ${text('2027 races to put in your calendar', { y: 590, size: 96, weight: 'heavy' }).svg}
    ${text(`${races.length} new half and full marathons, January to April, in ${[...new Set(races.map((e) => e.core_facts.country))].join(', ')}.`, { y: 980, size: 36, color: MUTED }).svg}`, { tag: '2027', page: 1, pages: P })];
  pages.forEach((list, i) => {
    let y = 300;
    const items = list.map((e) => {
      const date = `<text x="80" y="${y}" font-family="${FONT}" font-weight="700" font-size="34" letter-spacing="2" fill="${LIME}">${esc(dayLabel(e.core_facts.date).toUpperCase())} 2027</text>`;
      const name = text(short(e.name), { y: y + 62, size: 48, weight: 'heavy' });
      const meta = `<text x="80" y="${(y + 62 + name.height + 2).toFixed(0)}" font-family="${FONT}" font-size="32" fill="${MUTED}">${esc(`${place(e)} · ${dist(e.core_facts.distance_km)}`)}</text>`;
      y += 62 + name.height + 100;
      return date + name.svg + meta;
    }).join('');
    slides.push(frame(items, { tag: '2027', page: i + 2, pages: P }));
  });
  slides.push(frame(`
    ${text('Plan your 2027 season', { y: 440, size: 92, weight: 'heavy' }).svg}
    ${text('Every race we list links to the organiser’s own site. New races go up as soon as dates are confirmed.', { y: 680, size: 42 }).svg}
    <text x="80" y="1040" font-family="${HEAVY}" font-weight="900" font-size="84" fill="${LIME}">runsea.run</text>`, { tag: '2027', page: P, pages: P }));
  const files = await render(slides, OUT, '3-new-2027-races');
  captions.push({
    title: 'Post 3 (Sat 31 Oct): newly announced 2027 races',
    files,
    caption: `Just announced: ${races.length} half and full marathons for early 2027.\n\n${races.map((e) => `${dayLabel(e.core_facts.date)}: ${short(e.name)} (${e.core_facts.city.split(',')[0]})`).join('\n')}\n\nSave this for your 2027 plans. Dates, distances and official links at runsea.run (link in bio)\n\n#halfmarathon #marathon2027 #running #racecalendar #runningsingapore #runningmalaysia #runnersph #thailandrunning #runsea`,
  });
}

fs.writeFileSync(path.join(OUT, 'captions.md'), captions.map((c) => `## ${c.title}\n\nSlides: ${c.files.map((f) => path.basename(f)).join(', ')}\n\n${c.caption}\n`).join('\n---\n\n'));
console.log(`wrote ${captions.reduce((s, c) => s + c.files.length, 0)} slides + captions.md to ${OUT}`);
