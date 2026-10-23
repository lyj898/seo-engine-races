import fs from 'node:fs';
import path from 'node:path';
import { loadEntities, stripMeta } from './data.js';
import { getSeriesKey } from './succession.js';

/**
 * Finish-time benchmarks, built from data/finish-times/<slug>.json (written by
 * scripts/finish-times-fetch.js: per finisher only [seconds, gender, age band]).
 *
 * The rules agreed for what counts (methodology section on /finish-times/):
 *  - standard distances only (10K, half, full), chip time where published;
 *  - at least MIN_FINISHERS finishers in that distance at that race;
 *  - the race record still links an official results page and wasn't halted;
 *  - each race's most recent edition we hold, if it ran within the last
 *    WINDOW_DAYS (two years: a race whose newest edition isn't published yet,
 *    or isn't readable, still counts once through its previous one);
 *  - no events with an entry standard or a disrupted race day (EXCLUDED_SLUGS:
 *    qualifier finals, elite-only races, a haze-shortened fun run -- open legs
 *    of a series stay in).
 * We count finishes, not runners: without names, one person running three
 * races counts three times.
 */
export const DISTANCES = ['Half', 'Full', '10K'];
export const DISTANCE_LABEL = { Half: 'Half marathon', Full: 'Marathon', '10K': '10K' };
export const AGE_BANDS = ['U20', '20-29', '30-39', '40-49', '50-59', '60+'];
const MIN_FINISHERS = 200;
const MIN_SLICE = 100; // smallest group we'll quote a percentile against
const MIN_COUNTRY_RACES = 3; // a country needs this many races at a distance before it's shown for that distance
const WINDOW_DAYS = 731;
// Events with an entry standard, or whose times aren't a fair benchmark.
// Kept by slug so the list is explicit.
const EXCLUDED_SLUGS = new Set([
  'national-milo-marathon-2026-national-finals',
  // Half cut to 10 km on the day for haze and run as non-competitive.
  'the-kiprun-singapore-2026',
]);

const DIR = path.join(process.cwd(), 'data', 'finish-times');

function quantiles(sorted) {
  const out = [];
  for (let i = 0; i <= 100; i++) out.push(sorted[Math.round((i / 100) * (sorted.length - 1))]);
  return out;
}
// Median giving every race equal weight, so one 6,000-runner race can't stand
// in for a whole country.
function equalWeightMedian(groups) {
  const pts = [];
  for (const g of groups) for (const t of g) pts.push([t, 1 / g.length]);
  pts.sort((a, b) => a[0] - b[0]);
  const half = groups.length / 2;
  let acc = 0;
  for (const [t, w] of pts) { acc += w; if (acc >= half) return t; }
  return pts.at(-1)?.[0] ?? null;
}

let cache;
export function loadFinishTimes() {
  if (cache) return cache;
  const entities = new Map(loadEntities().map(stripMeta).map((e) => [e.slug, e]));
  const cutoff = new Date(Date.now() - WINDOW_DAYS * 864e5).toISOString().slice(0, 10);
  const races = [];
  let dataUpdated = null;
  // Newest usable edition per race series (slug without its year).
  const latest = new Map();
  if (fs.existsSync(DIR)) {
    for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.json'))) {
      const rec = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
      const e = entities.get(rec.slug);
      if (rec.fetched && (!dataUpdated || rec.fetched > dataUpdated)) dataUpdated = rec.fetched;
      if (!e || e.status === 'draft' || !e.results?.url || e.core_facts?.event_status) continue;
      if (EXCLUDED_SLUGS.has(e.slug) || (e.core_facts?.date ?? '') < cutoff) continue;
      const key = getSeriesKey(e);
      if (!latest.has(key) || latest.get(key).e.core_facts.date < e.core_facts.date) latest.set(key, { rec, e });
    }
    for (const { rec, e } of latest.values()) {
      // The race's main event is its longest standard distance, whether or
      // not it clears the minimum -- a race isn't re-ranked on a side event.
      const main = ['Full', 'Half', '10K'].find((k) => rec.distances?.[k]);
      for (const key of DISTANCES) {
        const d = rec.distances?.[key];
        if (!d || d.times.length < MIN_FINISHERS) continue;
        races.push({ slug: e.slug, name: e.name, country: e.core_facts.country, date: e.core_facts.date, distance: key, isMain: key === main, source: rec.source, times: d.times });
      }
    }
  }

  // Percentile tables: distance -> scope ("all" or a country) -> gender ("all","M","F") -> age ("all" or band) -> 101 quantiles
  const tables = {};
  const counts = {};
  for (const key of DISTANCES) {
    const rows = races.filter((r) => r.distance === key);
    if (!rows.length) continue;
    tables[key] = {};
    counts[key] = {};
    // Country scopes only where the country has enough races at this distance;
    // every race still counts towards the region-wide "all" scope.
    const perCountry = rows.reduce((m, r) => ((m[r.country] = (m[r.country] ?? 0) + 1), m), {});
    const scopes = ['all', ...Object.keys(perCountry).filter((c) => perCountry[c] >= MIN_COUNTRY_RACES)];
    for (const scope of scopes) {
      const pool = rows.filter((r) => scope === 'all' || r.country === scope).flatMap((r) => r.times);
      for (const g of ['all', 'M', 'F']) {
        for (const a of ['all', ...AGE_BANDS]) {
          const slice = pool.filter(([, gg, aa]) => (g === 'all' || gg === g) && (a === 'all' || aa === a)).map(([t]) => t).sort((x, y) => x - y);
          if (slice.length < MIN_SLICE) continue;
          ((tables[key][scope] ??= {})[g] ??= {})[a] = quantiles(slice);
          ((counts[key][scope] ??= {})[g] ??= {})[a] = slice.length;
        }
      }
    }
  }

  // Country comparison (equal weight per race) and race table (flagship = longest qualifying distance).
  const countries = {};
  for (const key of DISTANCES) {
    const byC = {};
    for (const r of races.filter((x) => x.distance === key)) (byC[r.country] ??= []).push(r.times.map(([t]) => t));
    countries[key] = Object.entries(byC)
      .filter(([, groups]) => groups.length >= MIN_COUNTRY_RACES)
      .map(([country, groups]) => ({ country, races: groups.length, finishes: groups.reduce((s, g) => s + g.length, 0), median: equalWeightMedian(groups) }))
      .sort((a, b) => a.median - b.median);
  }
  // Races are compared on their main event only (see `main` above), and only
  // against races whose main event is the same distance.
  const flagship = new Map(races.filter((r) => r.isMain).map((r) => [r.slug, r]));
  const raceTable = [...flagship.values()].map((r) => {
    const s = r.times.map(([t]) => t);
    return { slug: r.slug, name: r.name, country: r.country, date: r.date, distance: r.distance, finishers: s.length, top10: s[Math.round(0.1 * (s.length - 1))], median: s[Math.round(0.5 * (s.length - 1))] };
  });

  // Per-race tables for "where you'd rank at other races" (any qualifying distance).
  const raceQuantiles = races.map((r) => ({ slug: r.slug, name: r.name, country: r.country, distance: r.distance, n: r.times.length, q: quantiles(r.times.map(([t]) => t)) }));

  // Headline insights per distance, region-wide, for the Lab page. Everything
  // here is recomputed from the data at build time, so the page's numbers
  // move as races are added -- nothing is typed in by hand.
  const BINS = { Half: { from: 70 * 60, to: 240 * 60, step: 600 }, Full: { from: 180 * 60, to: 390 * 60, step: 900 }, '10K': { from: 40 * 60, to: 110 * 60, step: 300 } };
  const MILESTONE = { Half: 7200, Full: 14400, '10K': 3600 };
  const insights = {};
  for (const key of DISTANCES) {
    const rows = races.filter((r) => r.distance === key);
    if (!rows.length) continue;
    const all = rows.flatMap((r) => r.times);
    const sorted = all.map(([t]) => t).sort((a, b) => a - b);
    const byG = (g) => all.filter(([, gg]) => gg === g).map(([t]) => t).sort((a, b) => a - b);
    const M = byG('M');
    const F = byG('F');
    const at = (a, q) => (a.length ? a[Math.round(q * (a.length - 1))] : null);
    const { from, to, step } = BINS[key];
    const bins = [];
    for (let lo = from; lo <= to; lo += step) bins.push({ lo, open: lo === to, n: 0 });
    for (const t of sorted) {
      const i = Math.min(bins.length - 1, Math.max(0, Math.floor((t - from) / step)));
      bins[i].n++;
    }
    const ages = AGE_BANDS.map((band) => {
      const m = all.filter(([, g, a]) => g === 'M' && a === band).map(([t]) => t).sort((x, y) => x - y);
      const f = all.filter(([, g, a]) => g === 'F' && a === band).map(([t]) => t).sort((x, y) => x - y);
      return { band, men: m.length >= MIN_SLICE ? at(m, 0.5) : null, women: f.length >= MIN_SLICE ? at(f, 0.5) : null };
    }).filter((x) => x.men || x.women);
    insights[key] = {
      finishes: sorted.length,
      races: rows.length,
      median: at(sorted, 0.5),
      milestone: MILESTONE[key],
      underMilestone: sorted.filter((t) => t < MILESTONE[key]).length / sorted.length,
      womenShare: F.length / Math.max(1, M.length + F.length),
      men: { median: at(M, 0.5), top10: at(M, 0.1), top1: at(M, 0.01) },
      women: { median: at(F, 0.5), top10: at(F, 0.1), top1: at(F, 0.01) },
      bins,
      ages,
    };
  }

  const totalFinishes = races.reduce((n, r) => n + r.times.length, 0);
  cache = {
    tables, counts, countries, raceTable, raceQuantiles, insights, races: races.map(({ times, ...r }) => ({ ...r, finishers: times.length })),
    totalFinishes, raceCount: new Set(races.map((r) => r.slug)).size,
    // Every country with any race (for the intro), and those that qualify for at least one distance (for the picker).
    allCountries: [...new Set(races.map((r) => r.country))].sort(),
    countryList: [...new Set(Object.values(countries).flat().map((c) => c.country))].sort(),
    rules: { MIN_FINISHERS, MIN_SLICE, WINDOW_DAYS, MIN_COUNTRY_RACES },
    dataUpdated,
  };
  return cache;
}
