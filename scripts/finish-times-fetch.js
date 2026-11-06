#!/usr/bin/env node
/**
 * Fetch finishing times for races whose official results page we link
 * (entity.results.url) and write them to data/finish-times/<slug>.json.
 *
 * Only three things are kept per finisher: time in seconds, gender (M/F/U)
 * and a ten-year age band. Names, bibs, nationality, contact fields and
 * places are dropped as each page is read -- the files can't identify anyone.
 *
 * Readers exist for the platforms whose results are public and whose
 * robots.txt allows it (see runsea-results-test/PLATFORM_AUDIT.md). A race on
 * any other platform is skipped and listed at the end. Requests are paced at
 * about one a second.
 *
 *   node scripts/finish-times-fetch.js            # fetch races not yet saved
 *   node scripts/finish-times-fetch.js --refresh  # refetch everything
 *   node scripts/finish-times-fetch.js --history  # fetch past editions
 *
 * --history reads data/finish-times-history/sources.json (a list of
 * { series_slug, edition_year, edition_date, results_url, edition? }) and
 * writes each to data/finish-times-history/<series_slug>/<edition>.json, where
 * edition defaults to the year (set it to name a leg, e.g. "2025-leg-2", when a
 * series ran several in one year).
 * It's an archive of older editions, kept before timing companies take their
 * pages down. An upcoming race's page reads its own folder (keyed by the
 * upcoming record's slug) to show last year's field: see lastEditionField()
 * in src/lib/finishTimes.js.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTITIES = path.join(ROOT, 'data', 'entities');
const OUT = path.join(ROOT, 'data', 'finish-times');
const HISTORY = path.join(ROOT, 'data', 'finish-times-history');
const REFRESH = process.argv.includes('--refresh');
// --only=slug-a,slug-b re-fetches just those races (overwriting what's saved).
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url, as = 'json') {
  await sleep(1000);
  const opts = { headers: { 'User-Agent': UA, Accept: as === 'json' ? 'application/json' : 'text/html' } };
  // One retry after a pause on a dropped connection, so a long paged read
  // (blueChip: 130+ pages) isn't lost to a single network blip.
  const res = await fetch(url, opts).catch(async () => { await sleep(5000); return fetch(url, opts); });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return as === 'json' ? res.json() : res.text();
}

// "1:23:45" / "83:45" / "1:23:45.6" -> seconds
const clock = (t) => {
  if (!t || !/^\d+(:\d{1,2}){1,2}(\.\d+)?$/.test(String(t).trim())) return null;
  const p = String(t).trim().split(':').map(Number);
  return Math.round(p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1]);
};
const genderOf = (s) => (/^\s*(f|w|female|women|woman)/i.test(s || '') ? 'F' : /^\s*(m|male|men|man)\b/i.test(s || '') || /^m\d/i.test(s || '') ? 'M' : 'U');
// Any label carrying an age ("Male 25-29", "m30-39", "F40+", "19 - Below") -> ten-year band
function ageBand(label) {
  const s = String(label || '');
  // Open bands that straddle 20 ("18-29", "01-29", "<30") are counted as 20-29.
  const range = s.match(/(\d{1,2})\s*-\s*(\d{2})/);
  if (range && Number(range[1]) < 20 && Number(range[2]) >= 25) return '20-29';
  if (/<\s*30/.test(s)) return '20-29';
  if (/below|under|u\s?1\d|u20/i.test(s)) return 'U20';
  const m = s.match(/(\d{2})\s*(?:-|–|\+|\s*to\s*|and)/i) || s.match(/(\d{2})/);
  if (!m) return null;
  const lo = Number(m[1]);
  if (lo < 20) return 'U20';
  if (lo >= 60) return '60+';
  return `${Math.floor(lo / 10) * 10}-${Math.floor(lo / 10) * 10 + 9}`;
}
// Standard distances only; anything else is skipped.
const distanceKey = (m) => (m >= 9900 && m <= 10100 ? '10K' : m >= 20900 && m <= 21300 ? 'Half' : m >= 42000 && m <= 42400 ? 'Full' : null);
const metersFromLabel = (lbl) => {
  const m = String(lbl).match(/(\d+(?:\.\d+)?)\s*(k|km)/i);
  if (m) return Math.round(Number(m[1]) * 1000);
  if (/half|\bHM\b/i.test(lbl)) return 21097;
  if (/\bFM\b|marathon/i.test(lbl)) return 42195;
  return null;
};

// --- RaceRoster (results.raceroster.com) ---------------------------------
async function readRaceRoster(url) {
  const code = (url.match(/\/events\/([a-z0-9]{10,})/) || url.match(/results\/([a-z0-9]{10,})/) || [])[1];
  if (!code) throw new Error('no RaceRoster event code in ' + url);
  const ev = (await get(`https://results.raceroster.com/v2/api/events/${code}`)).data.event;
  const out = {};
  for (const se of ev.subEvents || []) {
    const meters = !se.distance ? null : se.distanceUnit === 'm' ? se.distance : se.distanceUnit === 'km' ? Math.round(se.distance * 1000) : se.distanceUnit === 'mi' ? Math.round(se.distance * 1609.34) : null;
    const key = distanceKey(meters);
    if (!key || out[key]) continue;
    const page = await get(`https://results.raceroster.com/v2/api/result-events/${ev.resultEventId}/sub-events/${se.id}/results?filter_search=&limit=10000`);
    const times = [];
    for (const r of page.data || []) {
      const t = clock(r.chipTime) ?? clock(r.gunTime);
      if (!t) continue;
      const label = r.division || '';
      // Some sub-events name the field genderSexId instead of gender.
      const sex = r.gender || r.genderSexId;
      times.push([t, sex ? genderOf(sex) : genderOf(label), ageBand(label)]);
    }
    out[key] = { meters, times };
  }
  return out;
}

// --- SportStats (sportstats.one) -----------------------------------------
async function readSportStats(url) {
  const slug = (url.match(/\/event\/([^/?#]+)/) || [])[1];
  if (!slug) throw new Error('no SportStats slug in ' + url);
  // /event/<slug> always shows the current edition; a past edition is only
  // reachable through its /event/<slug>/leaderboard/<rid> page.
  const listUrl = /\/leaderboard\/\d+/.test(url) ? url.split(/[?#]/)[0] : `https://sportstats.one/event/${slug}`;
  const html = (await get(listUrl, 'html')).replace(/\\"/g, '"');
  const races = [...html.matchAll(/\{"rid":(\d+),"lbl":"([^"]+)"\}/g)].map((m) => ({ rid: m[1], lbl: m[2] }));
  const out = {};
  for (const { rid, lbl } of races) {
    const meters = metersFromLabel(lbl);
    const key = distanceKey(meters);
    if (!key || out[key]) continue;
    const times = [];
    for (let offset = 0; ; offset += 1000) {
      const page = await get(`https://public.sportstats.one/getsortedresults?rid=${rid}&sort=overall&timeType=chip&offset=${offset}&limit=1000`);
      const rows = page.participantData || [];
      for (const r of rows) {
        const ms = r.ot || r.otg;
        if (!ms) continue; // rows with no finish time are DNF/DNS (ldo/ldg are gaps to the leader, not status)
        // A finish time with no chip or gun rank is listed but not placed by
        // the timer (disqualified or unofficial: at RnR Manila 2025 four of
        // them were faster than the 3:01 winner), so it isn't a finish.
        if (r.ranks && r.ranks.chip?.ro == null && r.ranks.gun?.ro == null) continue;
        times.push([Math.round(ms / 1000), genderOf(r.pg), ageBand(r.pc)]);
      }
      if (rows.length < 1000 || offset + 1000 >= (page.info?.total ?? 0)) break;
    }
    out[key] = { meters, times };
  }
  return out;
}

// --- UltimateLIVE (live.ultimate.dk; Singapore Marathon) -----------------
// The plain results view stops at 1,000 rows; the leaderboard view takes a
// `records` count and returns the whole field. Rows carry an age category
// such as "M30-39" (gender + age) and the finish time.
async function readUltimateLive(url) {
  const eventid = (url.match(/eventid=(\d+)/) || [])[1];
  if (!eventid) throw new Error('no UltimateLIVE eventid in ' + url);
  const base = 'https://live.ultimate.dk/desktop/front';
  const page = await get(`${base}/index.php?eventid=${eventid}&ignoreuseragent=true`, 'html');
  const sel = (page.match(/<select[^>]*leaderboard_distance_0[^>]*>([\s\S]*?)<\/select>/) || [])[1] || '';
  const options = [...sel.matchAll(/<option value="(\d+)"[^>]*>([^<]+)</g)].map((m) => ({ id: m[1], lbl: m[2] }));
  const out = {};
  for (const { id, lbl } of options) {
    const meters = metersFromLabel(lbl);
    const key = distanceKey(meters);
    if (!key || out[key]) continue;
    const html = await get(`${base}/data.php?eventid=${eventid}&mode=leaderboard&leaderboardid=1&distance=${id}&category=&records=40000&language=us&show=standings`, 'html');
    const times = [];
    for (const row of html.split(/<tr[\s>]/).slice(1)) {
      const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1].replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim());
      const cat = cells.find((c) => /^[MFW](\d{2}|U\d{2}|ELITE|\d{2}\+?)/i.test(c));
      const time = cells.map(clock).find((t) => t && t > 600);
      if (!time || !cat) continue;
      times.push([time, genderOf(cat), /ELITE/i.test(cat) ? null : ageBand(cat.replace(/^[MFW]/i, ''))]);
    }
    out[key] = { meters, times };
  }
  return out;
}

// --- Action.in.th (RFID Timing System, Thailand) ---------------------------
// One call returns every entrant; keep status "finished" rows only. Rows carry
// an exact age, which is turned into a ten-year band straight away.
async function readActionInTh(url) {
  const slug = (url.match(/\/event\/([^/?#]+)/) || [])[1];
  if (!slug) throw new Error('no Action.in.th slug in ' + url);
  const camp = await get(`https://live.action.in.th/api/campaigns/${slug}`);
  const c = camp.data || camp;
  const meters = Object.fromEntries((c.categories || []).map((k) => [k.name, metersFromLabel(k.distance || k.name)]));
  const res = await get(`https://live.action.in.th/api/runners?id=${c._id}`);
  const out = {};
  for (const r of res.data?.data || []) {
    if (r.status !== 'finished') continue;
    const key = distanceKey(meters[r.category]);
    const ms = r.netTime || r.elapsedTime;
    if (!key || !ms) continue;
    (out[key] ??= { meters: meters[r.category], times: [] }).times.push([Math.round(ms / 1000), genderOf(r.gender), Number.isFinite(r.age) ? ageBand(String(r.age) + '-') : null]);
  }
  return out;
}

// --- MyRunTime (<organiser>.myruntime.com, Philippines) --------------------
// Categories (and their distance) come from the winners endpoint; several
// categories can share a distance (e.g. "42KM Challenge" and "42KM Open
// Wave") and are merged. No age group is published.
async function readMyRunTime(url) {
  const u = new URL(url);
  const nick = (u.pathname.match(/\/results\/([^/?#]+)/) || [])[1];
  if (!nick) throw new Error('no MyRunTime race nick in ' + url);
  const api = `${u.origin}/raceDetailsService/api`;
  const w = (await get(`${api}/getRaceWinners?raceNick=${nick}`)).data || {};
  const distOf = {};
  for (const x of w.winners || []) if (x.categoryName && x.waveDistance) distOf[x.categoryName] = x.waveDistance;
  const out = {};
  for (const cat of w.raceCategories || []) {
    const meters = distOf[cat] || metersFromLabel(cat);
    const key = distanceKey(meters);
    if (!key) continue;
    for (let page = 1; page < 50; page++) {
      const d = (await get(`${api}/v1/getRaceResults?raceNick=${nick}&page=${page}&limit=5000&category=${encodeURIComponent(cat)}`)).data || {};
      const rows = d.tableData || [];
      for (const r of rows) {
        const t = clock(r.chipTimeDisplay) ?? clock(r.gunTimeDisplay);
        if (t) (out[key] ??= { meters, times: [] }).times.push([t, genderOf(r.gender), null]);
      }
      if (rows.length < 5000) break;
    }
  }
  return out;
}

// --- RaceTiger (nc.racetigertiming.com; JomRun races in Malaysia, some in Vietnam)
// The list endpoint answers only requests that look like the page's own fetch
// (same-origin fetch metadata plus the page's cookie). Filtering by gender
// works; the per-category filter doesn't, so no age group. Gun time only.
async function readRaceTiger(url) {
  const page = new URL(url);
  const res0 = await fetch(url, { headers: { 'User-Agent': UA } });
  const cookie = (res0.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
  const html = await res0.text();
  const raceId = (html.match(/id="race_id" value="(\d+)"/) || [])[1];
  const partner = page.searchParams.get('partner') || '000001';
  if (!raceId) throw new Error('no RaceTiger race id at ' + url);
  const events = [...html.matchAll(/qryEventList\(\s*'?(\d+)'?\s*\)"[^>]*>\s*([^<]+?)\s*</g)].map((m) => ({ id: m[1], lbl: m[2] }));
  const headers = {
    'User-Agent': UA, Cookie: cookie, Origin: page.origin, Referer: url, Accept: '*/*', 'Accept-Language': 'en-US,en;q=0.9',
    'Content-Type': 'application/x-www-form-urlencoded', 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Dest': 'empty',
  };
  const out = {};
  // Older pages post to /track/list, newer ones to /track3/list. Several
  // events can share a distance (e.g. "21.1KM SPEED" and "21.1KM LEISURE"
  // waves) and are merged.
  const listPath = /\/track3\//.test(page.pathname) ? '/track3/list' : '/track/list';
  for (const { id, lbl } of events) {
    const meters = metersFromLabel(lbl);
    const key = distanceKey(meters);
    if (!key) continue;
    const times = (out[key] ??= { meters, times: [] }).times;
    for (const [g, letter] of [['1', 'M'], ['2', 'F']]) {
      for (let p = 1; p < 100; p++) {
        await sleep(1000);
        const r = await fetch(`${page.origin}${listPath}`, { method: 'POST', headers, body: `partner=${partner}&raceId=${raceId}&eventId=${id}&categoryId=0&gender=${g}&page=${p}&row=500` });
        const j = await r.json().catch(() => ({}));
        const rows = j.obj || [];
        for (const row of rows) {
          const o = Object.fromEntries(row.map((f) => [f.fieldName, f.fieldValue]));
          const t = o.state === 'FIN' ? clock(o.gunTime) : null;
          if (t) times.push([t, letter, null]);
        }
        if (j.error !== 0 || rows.length < 500) break;
      }
    }
  }
  return out;
}

// --- VnExpress Marathon ranking pages backed by a Supabase table ------------
// (VPBank Hanoi). The organiser's results page links the ranking page, whose
// script carries the table's public read key and race code. We request only
// contest, gender, age group and times -- never the name or contact columns.
async function readVnExpressSupabase(url) {
  let ranking = /vm\.vnexpress\.net/.test(url) ? url : null;
  if (!ranking) {
    const html = await get(url, 'html');
    ranking = (html.match(/https:\/\/vm\.vnexpress\.net\/[^"'\s]+\/ranking[^"'\s]*/) || [])[0];
  }
  if (!ranking) throw new Error('no VnExpress ranking link at ' + url);
  const page = await get(ranking, 'html');
  const js = (page.match(/src="([^"]+\/index-[^"]+\.js)"/) || [])[1];
  if (!js) throw new Error('no ranking script at ' + ranking);
  const bundle = await get(js, 'html');
  const base = (bundle.match(/https:\/\/(?!xyzproject)[a-z0-9]+\.supabase\.co/) || [])[0];
  const key = (bundle.match(/sb_publishable_[A-Za-z0-9_-]{10,}/) || [])[0];
  const race = (bundle.match(/"([A-Z]{3,6}\d{2})"/) || [])[1];
  if (!base || !key || !race) throw new Error('could not read the ranking data source');
  const out = {};
  for (let offset = 0; offset < 100000; offset += 1000) {
    await sleep(1000);
    const res = await fetch(`${base}/rest/v1/result?select=Contest,Gender,AG,ChipTime,GunTime&Race=eq.${race}&offset=${offset}&limit=1000`, { headers: { 'User-Agent': UA, apikey: key, Authorization: `Bearer ${key}` } });
    const rows = await res.json();
    if (!Array.isArray(rows) || !rows.length) break;
    for (const r of rows) {
      const meters = metersFromLabel(r.Contest);
      const k = distanceKey(meters);
      const t = clock(r.ChipTime) ?? clock(r.GunTime);
      if (k && t) (out[k] ??= { meters, times: [] }).times.push([t, genderOf(r.Gender), ageBand(String(r.AG || '').replace(/^[MF]/i, '').replace('<30', '20-29'))]);
    }
    if (rows.length < 1000) break;
  }
  return out;
}

// --- run.id result sites (e.g. mm2026-results.run.id, Maybank Marathon) ----
// Server-rendered: one page shows a tab per distance (Marathon / Half
// Marathon / 10K), 50 rows each, all paged together by ?page=N. Cells:
// rank, name, bib, gender, chip, gun -- we read only gender and chip time.
async function readRunId(url) {
  const base = new URL(url).origin;
  const out = {};
  for (let page = 1; page < 400; page++) {
    const html = await get(`${base}/?page=${page}`, 'html');
    const tabs = [...html.matchAll(/href="#(tab\d)"[^>]*>\s*([^<]+?)\s*</g)].map((m) => ({ id: m[1], lbl: m[2] }));
    let any = false;
    tabs.forEach((tab, i) => {
      const start = html.indexOf(`id="${tab.id}"`);
      const next = tabs[i + 1] ? html.indexOf(`id="${tabs[i + 1].id}"`) : -1;
      const seg = html.slice(start, next > start ? next : undefined);
      const meters = metersFromLabel(tab.lbl);
      const key = distanceKey(meters);
      if (!key || start < 0) return;
      for (const row of seg.split(/<tr[\s>]/).slice(1)) {
        const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1].replace(/<[^>]*>/g, '').trim());
        const t = cells.map(clock).find((x) => x && x > 600);
        const g = cells.find((c) => /^(male|female)$/i.test(c));
        if (!t) continue;
        any = true;
        (out[key] ??= { meters, times: [] }).times.push([t, genderOf(g), null]);
      }
    });
    if (!any) break;
  }
  return out;
}

// --- Sporticx (result.sporticx.com, Indonesia) ----------------------------
// DataTables endpoint; rows are [no, rank, bib, name, gender, distance,
// category, gun time, status, link]. Gun time only; keep "Finished" rows.
async function readSporticx(url) {
  const slug = (url.match(/event_result\/([^/?#]+)/) || [])[1];
  if (!slug) throw new Error('no Sporticx slug in ' + url);
  const out = {};
  for (let start = 0, total = Infinity; start < total; start += 1000) {
    await sleep(1000);
    const res = await fetch('https://result.sporticx.com/result/load_table_result', {
      method: 'POST',
      headers: { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `draw=1&start=${start}&length=1000&slug=${encodeURIComponent(slug)}&distance=&category=&gender=`,
    });
    const j = await res.json();
    total = j.recordsTotal ?? 0;
    const rows = j.data || [];
    if (!rows.length) break;
    for (const r of rows) {
      if (!/finished/i.test(String(r[8]))) continue;
      const meters = metersFromLabel(String(r[5]));
      const key = distanceKey(meters);
      const t = clock(String(r[7]).replace(/<[^>]*>/g, '').trim());
      if (key && t) (out[key] ??= { meters, times: [] }).times.push([t, genderOf(r[4]), /master|40\+|50\+/i.test(String(r[6])) ? null : null]);
    }
  }
  return out;
}

// --- blueChip Timing (bluechipresults.com.au, RaceTec; The KIPRUN Singapore) --
// Server-rendered tables, 50 rows a page (&PageNo=N). The first row holds
// the column labels; we read only the Net Time, Category and Gender columns.
// Categories are age groups ("35-39", "60+") except the open "Under 35",
// which spans two of our bands and is left without one.
async function readBlueChip(url) {
  const u = new URL(url);
  const cid = u.searchParams.get('CId');
  const rid = u.searchParams.get('RId');
  if (!cid || !rid) throw new Error('no blueChip CId/RId in ' + url);
  const base = `${u.origin}/results.aspx?CId=${cid}&RId=${rid}`;
  const html = await get(base, 'html');
  const events = [...new Map([...html.matchAll(/[?&]EId=(\d+)">([^<]+)</g)].map((m) => [m[1], m[2].trim()])).entries()];
  const text = (s) => s.replace(/<[^>]*>/g, '').replace(/&nbsp;?/g, ' ').trim();
  const out = {};
  for (const [eid, lbl] of events) {
    const meters = metersFromLabel(lbl);
    const key = distanceKey(meters);
    if (!key) continue;
    const times = (out[key] ??= { meters, times: [] }).times;
    for (let p = 1, pages = 1; p <= pages && p < 400; p++) {
      const page = await get(`${base}&EId=${eid}&dt=0&PageNo=${p}`, 'html');
      pages = Number((page.match(/page \d+ of (\d+)/) || [])[1] || 1);
      const table = (page.match(/<table[^>]*tblResults[\s\S]*?<\/table>/) || [])[0] || '';
      const rows = table.split(/<tr[\s>]/).slice(1).map((r) => [...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => text(m[1])));
      const head = rows.shift() || [];
      const iNet = head.indexOf('Net Time');
      const iCat = head.indexOf('Category');
      const iGen = head.indexOf('Gender');
      if (iNet < 0 || iGen < 0) break;
      for (const c of rows) {
        const t = clock(c[iNet]);
        if (!t) continue;
        const cat = c[iCat] || '';
        times.push([t, genderOf(c[iGen]), /under|open/i.test(cat) ? null : ageBand(cat)]);
      }
    }
  }
  return out;
}

// --- Sixtime (result.sixtime.id, Indonesia) -------------------------------
// The results page names its JSON endpoint (BASE_API). Rows also carry phone,
// email and ID-card fields, so only category, sex, finisher flag and the net
// (else gun) time are read. Categories are "HM OPEN" / "10K MASTER" etc.; the
// open/master split isn't a ten-year band, so no age group.
async function readSixtime(url) {
  const html = await get(url, 'html');
  const api = (html.match(/BASE_API\s*=\s*'(https:\/\/result\.sixtime\.id\/api\/race\/results\/\d+)\/?'/) || [])[1];
  if (!api) throw new Error('no Sixtime results endpoint at ' + url);
  const out = {};
  for (let page = 1, total = Infinity; (page - 1) * 1000 < total && page < 100; page++) {
    const j = await get(`${api}?page=${page}&limit=1000&search=&sortBy=item_total_ranking&sortDir=asc`);
    total = j.total ?? 0;
    const rows = j.data || [];
    if (!rows.length) break;
    for (const { category, sex, finisher, net_score, total_score } of rows) {
      if (String(finisher) !== '1') continue;
      const meters = metersFromLabel(category);
      const key = distanceKey(meters);
      const t = clock(net_score) ?? clock(total_score);
      if (key && t) (out[key] ??= { meters, times: [] }).times.push([t, genderOf(sex), null]);
    }
  }
  return out;
}

// --- BOM Run time-result plugin (bomrun.id, Blue Ocean Minang Run) --------
// The organiser's WordPress page embeds the whole field as
// window.BOMRUN_TIME_RESULT. Category ("21K Umum Putra") gives the distance;
// "Timing Result" is gun time. No age group.
async function readBomRun(url) {
  const html = await get(url, 'html');
  const json = (html.match(/BOMRUN_TIME_RESULT\s*=\s*(\[[\s\S]*?\]);/) || [])[1];
  if (!json) throw new Error('no BOM Run result data at ' + url);
  const out = {};
  for (const { category, gender, time } of JSON.parse(json)) {
    const meters = metersFromLabel(category);
    const key = distanceKey(meters);
    const t = clock(time);
    if (key && t) (out[key] ??= { meters, times: [] }).times.push([t, genderOf(gender), null]);
  }
  return out;
}

// --- HeyJom results (api.heyjom.com/4-1/results/<code>; Garmin Run Asia
// Series Singapore 2025) -----------------------------------------------------
// Server-rendered, 1,000 rows a page, one distance at a time (?category=).
// We read only the Gender, Chip Time (else Gun Time) and Status columns and
// skip rows marked DNF/DNS. Categories are "21KM Men Open" etc.: no age group.
async function readHeyJom(url) {
  const base = url.split('?')[0];
  const first = await get(base, 'html');
  const sel = (first.match(/<select id="category_filter"[\s\S]*?<\/select>/) || [])[0] || '';
  const cats = [...sel.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]).filter((v) => v !== 'All');
  const text = (s) => s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const out = {};
  for (const cat of cats) {
    const meters = metersFromLabel(cat);
    const key = distanceKey(meters);
    if (!key) continue;
    const times = (out[key] ??= { meters, times: [] }).times;
    for (let p = 1; p < 100; p++) {
      const html = await get(`${base}?category=${encodeURIComponent(cat)}&gender=All&cat_gender=All&search_input=&page=${p}`, 'html');
      const head = [...((html.match(/<thead[\s\S]*?<\/thead>/) || [])[0] || '').matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => text(m[1]));
      const [iGen, iChip, iGun, iStatus] = ['Gender', 'Chip Time', 'Gun Time', 'Status'].map((h) => head.indexOf(h));
      const body = (html.match(/<tbody[\s\S]*?<\/tbody>/) || [])[0] || '';
      const rows = body.split(/<tr[\s>]/).slice(1).map((r) => [...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => text(m[1]))).filter((r) => r.length >= head.length - 1);
      if (iGen < 0 || !rows.length) break;
      for (const c of rows) {
        if (iStatus >= 0 && c[iStatus]) continue; // DNF / DNS / DQ
        const t = clock(c[iChip]) ?? clock(c[iGun]);
        if (t) times.push([t, genderOf(c[iGen]), null]);
      }
      if (rows.length < 1000) break;
    }
  }
  return out;
}

// --- race-result.asia (check.race-result.asia/<no>/<code>/results; Thai
// timer, not RaceResult GmbH) ---------------------------------------------
// One public JSON call returns the whole field. Keep status "Finished" rows
// only; read contest, gender, age group and chip (else gun) time. Age groups
// are "M30-39", "F60+", "M-U20" and the open "M-U30", which is counted as
// 20-29 (as "<30" is elsewhere).
async function readRaceResultAsia(url) {
  const code = (new URL(url).pathname.match(/^\/[^/]+\/([^/]+)/) || [])[1];
  if (!code) throw new Error('no race-result.asia event code in ' + url);
  const rows = await get(`https://check.race-result.asia/public/v1/events/${encodeURIComponent(code)}/results`);
  const out = {};
  for (const r of Array.isArray(rows) ? rows : []) {
    if (r.status !== 'Finished') continue;
    const meters = metersFromLabel(r.contest);
    const key = distanceKey(meters);
    const t = clock(r.chip_time) ?? clock(r.gun_time);
    if (!key || !t) continue;
    const ag = String(r.age_group || '').replace(/^[MF]-?/i, '');
    const band = /^U30$/i.test(ag) ? '20-29' : /^U20$/i.test(ag) ? 'U20' : /\d/.test(ag) ? ageBand(ag) : null;
    (out[key] ??= { meters, times: [] }).times.push([t, genderOf(r.gender), band]);
  }
  return out;
}

// Shared by the readers below: an age range with known ends -> ten-year band,
// or null when it spans two bands (e.g. "25-39", "19-39"). As in ageBand(),
// an open range straddling 20 ("18-29", "01-30") counts as 20-29.
function rangeBand(lo, hi) {
  if (lo == null && hi == null) return null;
  if (lo != null && lo >= 60) return '60+';
  if (hi != null && hi < 20) return 'U20';
  if (lo == null || hi == null) return null;
  if (lo < 20 && hi >= 25 && hi <= 30) return '20-29';
  return lo >= 20 && Math.floor(lo / 10) === Math.floor(hi / 10) ? ageBand(String(lo) + '-') : null;
}
const cellText = (s) => s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;?/g, ' ').replace(/\s+/g, ' ').trim();
const tableRows = (table) => table.split(/<tr[\s>]/).slice(1).map((r) => [...r.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((m) => cellText(m[1])));

// --- Royal MNL (royalmnl.com/results/<slug>, Philippines) -------------------
// The page carries the category list; the public API pages through each
// category 50 rows at a time. Rows hold the runner's birthday, which is
// turned into a ten-year band (age on race day) and dropped at once.
async function readRoyalMnl(url) {
  const slug = (url.match(/\/results\/([^/?#]+)/) || [])[1];
  if (!slug) throw new Error('no Royal MNL event slug in ' + url);
  const html = (await get(`https://www.royalmnl.com/results/${slug}`, 'html')).replace(/\\"/g, '"');
  const list = (html.match(/"categories":\[(.*?)\]/) || [])[1] || '';
  const cats = [...list.matchAll(/\{"id":"(\d+)","name":"([^"]+)"/g)].map((m) => ({ id: m[1], lbl: m[2] }));
  const out = {};
  for (const { id, lbl } of cats) {
    const meters = metersFromLabel(lbl);
    const key = distanceKey(meters);
    if (!key) continue;
    const times = (out[key] ??= { meters, times: [] }).times;
    for (let page = 1; page < 200; page++) {
      const j = await get(`https://www.royalmnl.com/api/public/results/${slug}/categories/${id}?page=${page}&pageSize=50`);
      for (const r of j.results || []) {
        if (r.status !== 'finished') continue;
        const t = Math.round(Number(r.netTimeMs || r.gunTimeMs) / 1000);
        if (!t) continue;
        const born = r.birthday ? new Date(r.birthday) : null;
        const day = new Date(r.finishAt || Date.now());
        const age = born ? Math.floor((day - born) / (365.25 * 864e5)) : null;
        times.push([t, genderOf(r.gender), age >= 10 && age <= 90 ? ageBand(String(age) + '-') : null]);
      }
      if (j.isLastPage !== false || !(j.results || []).length) break;
    }
  }
  return out;
}

// --- NCI timing (app.nci.co.id/timingrace/race-result/<eventId>, Indonesia) -
// One public call returns the whole field: category ("Kategori 21K"), gender
// (Pria/Wanita) and gun and chip durations in seconds. A chip start that is
// missing, or that makes chip time longer than gun time or 15+ minutes
// shorter (a late or misread start mat), falls back to gun time. No age group.
async function readNci(url) {
  const id = (url.match(/race-result\/(\d+)/) || [])[1];
  if (!id) throw new Error('no NCI event id in ' + url);
  const j = await get(`https://app.nci.co.id/base_funrun/api/Process/GetDataResultPublic?eventId=${id}`);
  const out = {};
  for (const r of j.data || []) {
    const meters = metersFromLabel(r.catName);
    const key = distanceKey(meters);
    const gun = r.durationGunChipTime;
    const chip = r.durationChipTime;
    const t = chip > 0 && gun > 0 && chip <= gun && gun - chip < 900 ? chip : gun;
    if (!key || !t) continue;
    const sex = /^pria|^laki/i.test(r.parsGender || '') ? 'M' : /^wanita|^perempuan/i.test(r.parsGender || '') ? 'F' : genderOf(r.parsGender);
    (out[key] ??= { meters, times: [] }).times.push([t, sex, null]);
  }
  return out;
}

// --- RaceTech PH (racetechph.com/uploadedresult/<slug>, Philippines) --------
// The event page links one server-rendered table per category and gender
// (/resultbycategory/<slug>/<cat>/<cat>/<Male|Female>). Rows are rank, name,
// gender rank, time; a time of 00:00:00 is a DNF. One time column, no age.
async function readRaceTechPh(url) {
  const html = await get(url, 'html');
  const links = [...new Set([...html.matchAll(/href='(\/resultbycategory\/[^']+\/(Male|Female))'/g)].map((m) => m[1]))];
  const out = {};
  for (const link of links) {
    const parts = link.split('/');
    const meters = metersFromLabel(decodeURIComponent(parts[3]));
    const key = distanceKey(meters);
    if (!key) continue;
    const page = await get(`https://racetechph.com${link}`, 'html');
    const table = (page.match(/<table[\s\S]*?<\/table>/) || [])[0] || '';
    const sex = genderOf(parts.at(-1));
    for (const c of tableRows(table).slice(1)) {
      const t = clock(c.at(-1));
      if (t) (out[key] ??= { meters, times: [] }).times.push([t, sex, null]);
    }
  }
  return out;
}

// --- runresults3.online (Thailand) -----------------------------------------
// The page's `Category` string lists each distance with its genders and age
// groups (label, min and max age); "getdata" returns a distance's rows,
// whose "Category" field is the distance,gender,age-group position in that
// string. We read only that, the status and the net (else finish) time.
async function readRunResults3(url) {
  const u = new URL(url);
  const ev = (u.pathname.match(/\/results\/([^/]+)/) || [])[1];
  if (!ev) throw new Error('no runresults3 event in ' + url);
  const base = `${u.origin}/results/${ev}`;
  const html = await get(`${base}/main`, 'html');
  const cat = (html.match(/const Category = '([^']*)'/) || [])[1];
  if (!cat) throw new Error('no category list at ' + url);
  const out = {};
  const dists = cat.split('<').slice(1).map((d, i) => ({
    index: i + 1,
    lbl: d.split('>')[0],
    genders: d.split('[').slice(1).map((g) => ({
      sex: /ชาย|^male|^men/i.test(g.split(']')[0]) ? 'M' : /หญิง|^female|^women/i.test(g.split(']')[0]) ? 'F' : 'U',
      bands: g.split('{').slice(1).map((a) => { const [, lo, hi] = a.split('}'); return rangeBand(/^\d+$/.test(lo) ? Number(lo) : null, /^\d+$/.test(hi) ? Number(hi) : null); }),
    })),
  }));
  for (const d of dists) {
    const meters = metersFromLabel(d.lbl);
    const key = distanceKey(meters);
    if (!key) continue;
    const times = (out[key] ??= { meters, times: [] }).times;
    for (let start = 0, total = Infinity; start < total; start += 500) {
      await sleep(1000);
      const res = await fetch(`${base}/getdata`, {
        method: 'POST',
        headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `Job=GetScoreData&Event=${ev}&Cond=${d.index},0,0&value=&Start=${start}&LiveModeIn=false&NumberOfData=500`,
      });
      const j = await res.json();
      total = j.total ?? 0;
      const rows = j.data || [];
      if (!rows.length) break;
      for (const r of rows) {
        if (!/FINISHED/i.test(r.Status) || /DISQUALIFIED|DNF/i.test(r.Status)) continue;
        // A net time missed at a mat is shown as "03 : 36 : 00.637 (Estimated)".
        const t = [r.NetTime, r.FinishTime].map((x) => clock(String(x || '').replace(/\(.*?\)|\s/g, ''))).find(Boolean);
        const [, g, a] = String(r.Category).split(',').map(Number);
        const gender = d.genders[g - 1];
        if (t) times.push([t, gender?.sex ?? 'U', gender?.bands[a - 1] ?? null]);
      }
    }
  }
  return out;
}

// --- The Timing Guys (thetimingguysresults.com/<Event>/<year>/) -------------
// ASP.NET pages: the event page links a list per race (/list/<Event>/<year>/
// <code>/), 100 rows a page, the next page reached by posting the form back.
// Columns: #, bib, name, country, finish gun time, gender, ..., division
// ("M19-39", "F40-49"). Para events are skipped.
async function readTimingGuys(url) {
  const u = new URL(url);
  const html = await get(url, 'html');
  const races = [...new Map([...html.matchAll(/<a href="(?:\.\.\/)*\/?(list\/[^"]+\/)">\s*([^<]+?)\s*</g)].map((m) => [m[1], m[2]])).entries()];
  const out = {};
  for (const [path, lbl] of races) {
    if (/para/i.test(lbl)) continue;
    const meters = metersFromLabel(lbl);
    const key = distanceKey(meters);
    if (!key) continue;
    const times = (out[key] ??= { meters, times: [] }).times;
    const listUrl = `${u.origin}/${path}`;
    let page = await get(listUrl, 'html');
    for (let n = 0; n < 200; n++) {
      const rows = tableRows((page.match(/<table[\s\S]*?<\/table>/) || [])[0] || '');
      const head = rows.shift() || [];
      const iTime = head.findIndex((h) => /time/i.test(h));
      const iGen = head.indexOf('Gender');
      const iDiv = head.indexOf('Division');
      if (iTime < 0 || !rows.length) break;
      for (const c of rows) {
        const t = clock(c[iTime]);
        if (!t) continue;
        const ages = (c[iDiv] || '').match(/(\d{1,2})\s*-\s*(\d{1,2})|(\d{2})\+/);
        const band = !ages ? null : ages[3] ? rangeBand(Number(ages[3]), null) : rangeBand(Number(ages[1]), Number(ages[2]));
        times.push([t, genderOf(c[iGen]), band]);
      }
      if (!/btnNextT/.test(page)) break;
      const form = new URLSearchParams();
      for (const m of page.matchAll(/<input type="hidden" name="([^"]+)" id="[^"]*" value="([^"]*)"/g)) form.set(m[1], m[2].replace(/&amp;/g, '&'));
      form.set('__EVENTTARGET', 'ctl00$pagePlaceHolder$btnNextT');
      form.set('__EVENTARGUMENT', '');
      await sleep(1000);
      const res = await fetch(listUrl, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
      const next = await res.text();
      const firstRow = (s) => (s.match(/SHOWING ROWS:\s*(\d+)/) || [])[1];
      if (!res.ok || firstRow(next) === firstRow(page)) break;
      page = next;
    }
  }
  return out;
}

// --- Sada Raga (raceresult.sadaraga.co.id/<event>, Indonesia) ---------------
// Server-rendered: one page per distance (/<event>/42k), ?limit=100&page=N.
// We read only the Chip Time, Gun Time, Position Cat and Gender columns; a
// row with no category position (cut-off or disqualified) isn't a finish.
// Categories are Open/Closed/Master: no age group.
async function readSadaRaga(url) {
  const u = new URL(url);
  const ev = u.pathname.split('/').filter(Boolean)[0];
  if (!ev) throw new Error('no Sada Raga event in ' + url);
  const html = await get(`${u.origin}/${ev}`, 'html');
  const dists = [...new Set([...html.matchAll(new RegExp(`href="${u.origin}/${ev}/([a-z0-9.]+)"`, 'gi'))].map((m) => m[1]))];
  const out = {};
  for (const d of dists) {
    const meters = metersFromLabel(d);
    const key = distanceKey(meters);
    if (!key) continue;
    const times = (out[key] ??= { meters, times: [] }).times;
    for (let p = 1; p < 300; p++) {
      const page = await get(`${u.origin}/${ev}/${d}?limit=100&page=${p}`, 'html');
      const rows = tableRows((page.match(/<table[\s\S]*?<\/table>/g) || []).at(-1) || '');
      const head = rows.find((r) => r.includes('Chip Time')) || [];
      const [iChip, iGun, iPos, iGen] = ['Chip Time', 'Gun Time (Chip Time)', 'Position Cat', 'Gender'].map((h) => head.indexOf(h));
      const body = rows.filter((r) => r.length === head.length && r !== head && !r.includes('Chip Time'));
      if (iChip < 0 || !body.length) break;
      for (const c of body) {
        if (!/^\d+$/.test(c[iPos])) continue;
        const t = clock(c[iChip]) ?? clock((c[iGun] || '').split(' ')[0]);
        if (t) times.push([t, genderOf(c[iGen]), null]);
      }
    }
  }
  return out;
}

// --- PickMyRace (pickmyrace.id/result/<type>/<id>, Indonesia) ---------------
// The event record names one JSON feed per category (on
// pickmyrace.frizacahya.com); each returns the category's whole field. We
// read only gender, status and finish time. Categories are Open: no age group.
async function readPickMyRace(url) {
  const id = (url.match(/\/result\/\d+\/([A-Za-z0-9]+)/) || [])[1];
  if (!id) throw new Error('no PickMyRace event id in ' + url);
  const ev = await get(`https://pickmyrace.id/api/events/detail/${id}`);
  const out = {};
  for (const c of ev.categories || []) {
    const meters = metersFromLabel(c.name);
    const key = distanceKey(meters);
    if (!key || !/^https:\/\/pickmyrace\.frizacahya\.com\//.test(c.api || '')) continue;
    const rows = await get(c.api);
    for (const r of Array.isArray(rows) ? rows : []) {
      if (!/FINISH/i.test(r.STATUS || '')) continue;
      const t = clock(r.FINISHTIME);
      if (t) (out[key] ??= { meters, times: [] }).times.push([t, genderOf(r.GENDER), null]);
    }
  }
  return out;
}

// --- Outdoor Statement (results.outdoorstatement.com/?race=<name>, PH) ------
// Server-rendered: ?race=&distance=<21KM>&per_page=100&page=N. We read the
// Status and Time columns and the gender letter in the participant cell
// ("..., M Age Category"). The age shown is 0 for everyone: no age group.
async function readOutdoorStatement(url) {
  const u = new URL(url);
  const race = u.searchParams.get('race');
  if (!race) throw new Error('no Outdoor Statement race in ' + url);
  const base = `${u.origin}/?race=${encodeURIComponent(race)}`;
  const html = await get(base, 'html');
  const sel = (html.match(/<select name="distance"[\s\S]*?<\/select>/) || [])[0] || '';
  const dists = [...sel.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
  const out = {};
  for (const d of dists) {
    const meters = metersFromLabel(d);
    const key = distanceKey(meters);
    if (!key) continue;
    const times = (out[key] ??= { meters, times: [] }).times;
    for (let p = 1, pages = 1; p <= pages && p < 200; p++) {
      const page = await get(`${base}&distance=${encodeURIComponent(d)}&per_page=100&page=${p}`, 'html');
      pages = Math.max(1, ...[...page.matchAll(/[?&]page=(\d+)/g)].map((m) => Number(m[1])));
      const rows = tableRows((page.match(/<table[\s\S]*?<\/table>/) || [])[0] || '');
      const head = rows.shift() || [];
      const [iWho, iStatus, iTime] = ['Participant', 'Status', 'Time'].map((h) => head.indexOf(h));
      if (iTime < 0) break;
      for (const c of rows) {
        if (!/FINISH/i.test(c[iStatus] || '')) continue;
        const t = clock(c[iTime]);
        const sex = ((c[iWho] || '').match(/,\s*([MF])\s+Age/) || [])[1];
        if (t) times.push([t, sex || 'U', null]);
      }
    }
  }
  return out;
}

// --- VnExpress Marathon ranking (vm.vnexpress.net/<race>, other than VPBank) -
// The race page carries its match id and a range id per distance; the
// /bang-xep-hang endpoint returns a distance's finishers by gender. That JSON
// also carries runners' names and email addresses: only gender, age range and
// the net (else gun) time are read, and the rest is dropped unread. Pacers
// (age range "Pacer") run to set times and are left out.
async function readVnExpressRanking(url) {
  const html = await get(url.split(/[?#]/)[0], 'html');
  const match = (html.match(/name="iph_match" value="(\d+)"/) || [])[1];
  const ranges = [...html.matchAll(/id="range-(\d+)km"\s+range="(\d+)"/g)].map((m) => ({ km: Number(m[1]), id: m[2] }));
  if (!match || !ranges.length) throw new Error('no VnExpress ranking data at ' + url);
  const out = {};
  for (const { km, id } of ranges) {
    const meters = km === 21 ? 21097 : km === 42 ? 42195 : km * 1000;
    const key = distanceKey(meters);
    if (!key) continue;
    const times = (out[key] ??= { meters, times: [] }).times;
    for (const g of ['male', 'female']) {
      for (let offset = 0; offset < 50000;) {
        const j = await get(`https://vm.vnexpress.net/bang-xep-hang?race_id=${match}&range=${id}&gender=${g}&offset=${offset}&limit=500`);
        const rows = j.data?.list_runners || [];
        if (!rows.length) break;
        for (const { age_range: ag, time_finish: chip, guntime: gun } of rows) {
          if (/pacer/i.test(ag || '')) continue;
          // Despite the names, "guntime" is the net (chip) time and
          // "time_finish" the gun time: the first is never the larger, and
          // the ranking and the 3:30 half cut-off follow it.
          const both = [clock(chip), clock(gun)].filter(Boolean);
          const t = both.length ? Math.min(...both) : null;
          const m = String(ag || '').match(/(\d{1,2})\s*-\s*(\d{1,2})|(\d{2})\+/);
          const band = !m ? null : m[3] ? rangeBand(Number(m[3]), null) : rangeBand(Number(m[1]), Number(m[2]));
          if (t) times.push([t, g === 'male' ? 'M' : 'F', band]);
        }
        offset += rows.length;
      }
    }
  }
  return out;
}

// --- Cambodia Events (cambodia-events.org/result?event=<id>) -----------------
// Server-rendered, 50 rows a page, filtered by &distance=<42KM>. Columns: bib,
// name, distance, gender, status, overall, category (a rank), time. We read
// only gender, status and time. No age group.
async function readCambodiaEvents(url) {
  const u = new URL(url);
  const ev = u.searchParams.get('event');
  if (!ev) throw new Error('no Cambodia Events event id in ' + url);
  const base = `${u.origin}/result?event=${encodeURIComponent(ev)}`;
  const html = await get(base, 'html');
  const sel = (html.match(/<select name=["']?distance[\s\S]*?<\/select>/) || [])[0] || '';
  const dists = [...sel.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
  const out = {};
  for (const d of dists) {
    const meters = metersFromLabel(d);
    const key = distanceKey(meters);
    if (!key) continue;
    const times = (out[key] ??= { meters, times: [] }).times;
    for (let p = 1, pages = 1; p <= pages && p < 300; p++) {
      const page = await get(`${base}&distance=${encodeURIComponent(d)}&page=${p}`, 'html');
      pages = Math.max(1, ...[...page.matchAll(/[?&;]page=(\d+)/g)].map((m) => Number(m[1])));
      const rows = tableRows((page.match(/<table[\s\S]*?<\/table>/) || [])[0] || '');
      const head = rows.shift() || [];
      const [iGen, iStatus, iTime] = ['Gender', 'Status', 'Time'].map((h) => head.indexOf(h));
      if (iTime < 0 || !rows.length) break;
      for (const c of rows) {
        if (!/finish/i.test(c[iStatus] || '')) continue;
        const t = clock(c[iTime]);
        if (t) times.push([t, genderOf(c[iGen]), null]);
      }
    }
  }
  return out;
}

// --- ThaiMTB Chip / LiveRaceMAP (chip.thaimtb.com/?view=result&raceid=<id>) --
// The race's config.jsonc names its events (42K, 21K, ...); the leaderboard
// API returns an event's whole field. We read only status, gender, category
// ("M 30-39", or "Overall Male" for the podium) and the net (else gun) time.
async function readThaiMtb(url) {
  const u = new URL(url);
  const race = u.searchParams.get('raceid');
  if (!race) throw new Error('no ThaiMTB race id in ' + url);
  const cfg = JSON.parse((await get(`${u.origin}/racemap/config/${race}/config.jsonc`, 'html')).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/,(\s*[}\]])/g, '$1'));
  const out = {};
  for (const [ev, def] of Object.entries(cfg.Event || {})) {
    if (def?.NOTRACE) continue;
    const meters = metersFromLabel(ev);
    const key = distanceKey(meters);
    if (!key) continue;
    const j = await get(`${u.origin}/backend-api/api/leaderboard?raceID=${race}&event=${encodeURIComponent(ev)}&view=field&limit=100000`);
    for (const r of j.runners || []) {
      if (!/^finish/i.test(r.status || '')) continue;
      const t = clock(r.net_time) ?? clock(r.time);
      if (t) (out[key] ??= { meters, times: [] }).times.push([t, genderOf(r.gender), ageBand(r.category)]);
    }
  }
  return out;
}

// Pages through a public Supabase table (read with the anon key the results
// page itself ships), asking only for the named columns.
async function supabaseRows(base, key, table, query) {
  const rows = [];
  for (let offset = 0; offset < 100000; offset += 1000) {
    await sleep(1000);
    const res = await fetch(`${base}/rest/v1/${table}?${query}&order=id.asc&offset=${offset}&limit=1000`, { headers: { 'User-Agent': UA, apikey: key, Authorization: `Bearer ${key}` } });
    if (!res.ok) throw new Error(`${res.status} ${table}`);
    const page = await res.json();
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows;
}

// --- Lariterus (result.lariterus.info/<slug>, Indonesia) ---------------------
// A Flutter app over Supabase: the result_routes row for the slug names the
// event's table. We request only category ("FM Umum", "10K Master"), gender
// and gun time -- never the name or bib. Umum/Master isn't an age group.
async function readLariterus(url) {
  const u = new URL(url);
  const slug = u.pathname.split('/').filter(Boolean)[0];
  if (!slug) throw new Error('no Lariterus slug in ' + url);
  const bundle = await get(`${u.origin}/main.dart.js`, 'html');
  const base = (bundle.match(/https:\/\/[a-z0-9]+\.supabase\.co/) || [])[0];
  const key = (bundle.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/) || [])[0];
  if (!base || !key) throw new Error('could not read the Lariterus data source');
  const [route] = await supabaseRows(base, key, 'result_routes', `select=id,table_name&slug=eq.${encodeURIComponent(slug)}`);
  if (!/^[a-z0-9_]+$/i.test(route?.table_name || '')) throw new Error('no Lariterus results table for ' + slug);
  const out = {};
  for (const r of await supabaseRows(base, key, route.table_name, 'select=category,gender,gun_time')) {
    const meters = metersFromLabel(r.category);
    const k = distanceKey(meters);
    const t = clock(r.gun_time);
    if (k && t) (out[k] ??= { meters, times: [] }).times.push([t, genderOf(r.gender), null]);
  }
  return out;
}

// --- Bromo Marathon (bromomarathon.com/past-results[?year=YYYY]) -------------
// The archive page carries its Supabase table's public read key; rows are
// keyed by year. The edition is the URL's ?year=, else the page's default
// (the latest edition). We request only category, gender, status and the
// net/finish times. Podium rows have status "Winner N". No age group.
async function readBromo(url) {
  const html = await get(url.split('#')[0], 'html');
  const base = (html.match(/https:\/\/[a-z0-9]+\.supabase\.co/) || [])[0];
  const key = (html.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/) || [])[0];
  const year = new URL(url).searchParams.get('year') || (html.match(/let currentYear = (\d{4})/) || [])[1];
  if (!base || !key || !/^\d{4}$/.test(year || '')) throw new Error('could not read the Bromo results source');
  const out = {};
  for (const r of await supabaseRows(base, key, 'bromar_race_results', `select=category,gender,status,net_time,finish_time&year=eq.${year}`)) {
    if (!/finish|winner/i.test(r.status || '')) continue;
    const meters = metersFromLabel(r.category);
    const k = distanceKey(meters);
    const t = clock(r.net_time) ?? clock(r.finish_time);
    if (k && t) (out[k] ??= { meters, times: [] }).times.push([t, genderOf(r.gender), null]);
  }
  return out;
}

const READERS = [
  { name: 'RaceRoster', test: /results\.raceroster\.com/, read: readRaceRoster },
  { name: 'SportStats', test: /sportstats\.one/, read: readSportStats },
  { name: 'UltimateLIVE', test: /live\.ultimate\.dk/, read: readUltimateLive },
  { name: 'Action.in.th', test: /live\.action\.in\.th/, read: readActionInTh },
  { name: 'MyRunTime', test: /myruntime\.com\/results\//, read: readMyRunTime },
  { name: 'RaceTiger', test: /racetigertiming\.com/, read: readRaceTiger },
  { name: 'VnExpress', test: /vpbankmarathon\.com|vm\.vnexpress\.net\/vpbank/, read: readVnExpressSupabase },
  { name: 'run.id', test: /results\.run\.id/, read: readRunId },
  { name: 'Sporticx', test: /result\.sporticx\.com/, read: readSporticx },
  { name: 'blueChip', test: /bluechipresults\.com\.au\/results\.aspx/i, read: readBlueChip },
  { name: 'Sixtime', test: /result\.sixtime\.id\/event\//, read: readSixtime },
  { name: 'BOM Run', test: /bomrun\.id\/timeresult/, read: readBomRun },
  { name: 'HeyJom', test: /api\.heyjom\.com\/4-1\/results\//, read: readHeyJom },
  { name: 'race-result.asia', test: /check\.race-result\.asia\//, read: readRaceResultAsia },
  { name: 'Royal MNL', test: /royalmnl\.com\/results\//, read: readRoyalMnl },
  { name: 'NCI', test: /app\.nci\.co\.id\/timingrace\/race-result\/\d+/, read: readNci },
  { name: 'RaceTech PH', test: /racetechph\.com\/uploadedresult\//, read: readRaceTechPh },
  { name: 'runresults3', test: /runresults3\.online\/results\//, read: readRunResults3 },
  { name: 'The Timing Guys', test: /thetimingguysresults\.com\/[^/]+\/\d{4}/, read: readTimingGuys },
  { name: 'Sada Raga', test: /raceresult\.sadaraga\.co\.id\/[^/?#]+/, read: readSadaRaga },
  { name: 'PickMyRace', test: /pickmyrace\.id\/result\//, read: readPickMyRace },
  { name: 'Outdoor Statement', test: /results\.outdoorstatement\.com\/\?race=/, read: readOutdoorStatement },
  // Other VnExpress races (not VPBank, which is read above) use the
  // /bang-xep-hang ranking feed.
  { name: 'VnExpress', test: /vm\.vnexpress\.net\/(?!vpbank)[a-z0-9-]+-\d{4}/, read: readVnExpressRanking },
  { name: 'Cambodia Events', test: /cambodia-events\.org\/result\?(?:.*&)?event=\d+/, read: readCambodiaEvents },
  { name: 'ThaiMTB Chip', test: /chip\.thaimtb\.com\/\?(?:.*&)?raceid=\d+/, read: readThaiMtb },
  { name: 'Lariterus', test: /result\.lariterus\.info\/[^/?#]+/, read: readLariterus },
  { name: 'Bromo Marathon', test: /bromomarathon\.com\/past-results/, read: readBromo },
];

// Each job is one results page to read: the latest edition of a race we list,
// or (with --history) a past edition from the archive's source list.
const jobs = [];
if (process.argv.includes('--history')) {
  for (const s of JSON.parse(fs.readFileSync(path.join(HISTORY, 'sources.json'), 'utf8'))) {
    if (ONLY.length && !ONLY.includes(s.series_slug)) continue;
    jobs.push({
      label: `${s.series_slug} ${s.edition_year}`,
      url: s.results_url,
      dest: path.join(HISTORY, s.series_slug, `${s.edition ?? s.edition_year}.json`),
      head: { series_slug: s.series_slug, edition_year: s.edition_year, ...(s.edition && { edition: s.edition }), edition_date: s.edition_date ?? null },
    });
  }
} else {
  for (const file of fs.readdirSync(ENTITIES).filter((f) => f.endsWith('.json'))) {
    const e = JSON.parse(fs.readFileSync(path.join(ENTITIES, file), 'utf8'));
    if (!e.results?.url || e.status === 'draft' || e.core_facts?.event_status) continue;
    if (ONLY.length && !ONLY.includes(e.slug)) continue;
    jobs.push({ label: e.slug, url: e.results.url, dest: path.join(OUT, `${e.slug}.json`), head: { slug: e.slug } });
  }
}

const skipped = [];
let saved = 0;
for (const job of jobs) {
  const reader = READERS.find((r) => r.test.test(job.url));
  if (!reader) { skipped.push(`${job.label} (${new URL(job.url).hostname})`); continue; }
  if (fs.existsSync(job.dest) && !REFRESH && !ONLY.length) continue;
  try {
    const distances = await reader.read(job.url);
    for (const d of Object.values(distances)) {
      d.times = d.times.filter(([t]) => t >= 600 && t <= 12 * 3600).sort((a, b) => a[0] - b[0]);
      d.finishers = d.times.length;
    }
    if (!Object.keys(distances).length) { skipped.push(`${job.label} (no standard distances)`); continue; }
    fs.mkdirSync(path.dirname(job.dest), { recursive: true });
    fs.writeFileSync(job.dest, JSON.stringify({ ...job.head, source: reader.name, results_url: job.url, fetched: new Date().toISOString().slice(0, 10), distances }) + '\n');
    saved++;
    console.log(`saved ${job.label}: ${Object.entries(distances).map(([k, d]) => `${k} ${d.finishers}`).join(', ')}`);
  } catch (err) {
    skipped.push(`${job.label} (error: ${err.message})`);
  }
}
console.log(`\n${saved} race(s) saved. ${skipped.length} skipped (no reader yet or error):`);
for (const s of skipped) console.log('  ' + s);
