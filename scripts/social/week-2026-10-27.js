#!/usr/bin/env node
// Social posts for the week of 27 Oct 2026: a Lab stat carousel, this
// weekend's races, and newly announced 2027 races. Numbers come from the
// site's own data at run time. Output (PNGs + captions.md) goes to
// OneDrive Documents\runsea-social\2026-10-27, outside the repo.
//
//   node scripts/social/week-2026-10-27.js
import fs from 'node:fs';
import path from 'node:path';
import { loadEntities, stripMeta } from '../../src/lib/data.js';
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

// ---- Post 2 (Thu): this weekend's races -----------------------------------
{
  const from = '2026-10-31', to = '2026-11-01';
  const races = entities.filter((e) => e.core_facts.date >= from && e.core_facts.date <= to).sort((a, b) => a.core_facts.country.localeCompare(b.core_facts.country) || a.core_facts.date.localeCompare(b.core_facts.date));
  const byCountry = [...new Set(races.map((e) => e.core_facts.country))].map((c) => [c, races.filter((e) => e.core_facts.country === c)]);
  const P = byCountry.length + 2;
  const slides = [frame(`
    <text x="80" y="560" font-family="${HEAVY}" font-weight="900" font-size="300" fill="${LIME}">${races.length}</text>
    ${text('half and full marathons this weekend', { y: 690, size: 72, weight: 'heavy' }).svg}
    ${text(`${dayLabel(from)} – ${dayLabel(to)} · ${byCountry.map(([c]) => c).join(', ')}`, { y: 960, size: 36, color: MUTED }).svg}`, { tag: 'This weekend', page: 1, pages: P })];
  byCountry.forEach(([country, list], i) => {
    let y = 400;
    const items = list.map((e) => {
      const name = text(short(e.name), { y, size: 50, weight: 'heavy' });
      const meta = `<text x="80" y="${(y + name.height + 4).toFixed(0)}" font-family="${FONT}" font-size="34" fill="${MUTED}">${esc(`${dayLabel(e.core_facts.date)} · ${e.core_facts.city.split(',')[0]} · ${dist(e.core_facts.distance_km)}`)}</text>`;
      const block = name.svg + meta;
      y += name.height + 110;
      return block;
    }).join('');
    slides.push(frame(`<text x="80" y="290" font-family="${HEAVY}" font-weight="900" font-size="88" fill="${LIME}">${esc(country)}</text>${items}`, { tag: 'This weekend', page: i + 2, pages: P }));
  });
  slides.push(frame(`
    ${text('Racing this weekend?', { y: 420, size: 90, weight: 'heavy' }).svg}
    ${text('It is still haze season. Check your organiser’s page the night before you travel.', { y: 660, size: 42 }).svg}
    ${text('Every half and full marathon in Southeast Asia, with dates and official links:', { y: 880, size: 36, color: MUTED }).svg}
    <text x="80" y="1060" font-family="${HEAVY}" font-weight="900" font-size="84" fill="${LIME}">runsea.run</text>`, { tag: 'This weekend', page: P, pages: P }));
  const files = await render(slides, OUT, '2-this-weekend');
  captions.push({
    title: `Post 2 (Thu 29 Oct): ${races.length} races this weekend`,
    files,
    caption: `${races.length} half and full marathons across Southeast Asia this weekend (${dayLabel(from)} – ${dayLabel(to)}):\n\n${byCountry.map(([c, l]) => `${c}: ${l.map((e) => short(e.name)).join(', ')}`).join('\n')}\n\nStill haze season, so check your organiser's page before you travel. Full calendar with official links at runsea.run (link in bio)\n\n#halfmarathon #marathon #raceweekend #running #runningmalaysia #larimalaysia #thailandrunning #vietnamrunners #lariindonesia #runsea`,
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
