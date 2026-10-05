#!/usr/bin/env node
// Lists races whose date has passed in the last N days (default 21) and
// that have no `results` link yet -- the window when "<race> results"
// searches peak. Cancelled and postponed editions are skipped: there are no
// results to find. Each line gives the organiser's site, which is usually
// where the timing company's results page is linked from.
//
//   node scripts/results-due.js            # last 21 days
//   node scripts/results-due.js --days 45
//
// Fill a race in by adding to its record:
//   "results": { "url": "...", "publisher": "RaceTime", "last_checked": "2026-10-05" }
// using a page you have seen list this edition's finishers.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'data', 'entities');

const daysArg = process.argv.indexOf('--days');
const days = daysArg > -1 ? Number(process.argv[daysArg + 1]) : 21;
const today = new Date().toISOString().slice(0, 10);
const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);

const due = [];
let done = 0;
for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.json'))) {
  const e = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
  const date = e.core_facts?.date;
  if (e.status === 'draft' || typeof date !== 'string' || date.length < 10) continue;
  if (date >= today || date < since || e.core_facts?.event_status) continue;
  if (e.results) { done++; continue; }
  due.push({ date, slug: e.slug, name: e.name, organizer: e.core_facts?.organizer ?? '', site: e.cta_links?.[0]?.url ?? '' });
}

due.sort((a, b) => b.date.localeCompare(a.date));
console.log(`Races run ${since} to ${today} with no results link: ${due.length} (${done} already have one)\n`);
for (const r of due) console.log(`${r.date}  ${r.slug}\n            ${r.name}${r.organizer ? ` -- ${r.organizer}` : ''}\n            ${r.site}`);
