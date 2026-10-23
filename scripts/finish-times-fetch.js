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
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTITIES = path.join(ROOT, 'data', 'entities');
const OUT = path.join(ROOT, 'data', 'finish-times');
const REFRESH = process.argv.includes('--refresh');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url, as = 'json') {
  await sleep(1000);
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: as === 'json' ? 'application/json' : 'text/html' } });
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
      times.push([t, r.gender ? genderOf(r.gender) : genderOf(label), ageBand(label)]);
    }
    out[key] = { meters, times };
  }
  return out;
}

// --- SportStats (sportstats.one) -----------------------------------------
async function readSportStats(url) {
  const slug = (url.match(/\/event\/([^/?#]+)/) || [])[1];
  if (!slug) throw new Error('no SportStats slug in ' + url);
  const html = (await get(`https://sportstats.one/event/${slug}`, 'html')).replace(/\\"/g, '"');
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
];

fs.mkdirSync(OUT, { recursive: true });
const skipped = [];
let saved = 0;
for (const file of fs.readdirSync(ENTITIES).filter((f) => f.endsWith('.json'))) {
  const e = JSON.parse(fs.readFileSync(path.join(ENTITIES, file), 'utf8'));
  if (!e.results?.url || e.status === 'draft' || e.core_facts?.event_status) continue;
  const reader = READERS.find((r) => r.test.test(e.results.url));
  if (!reader) { skipped.push(`${e.slug} (${new URL(e.results.url).hostname})`); continue; }
  const dest = path.join(OUT, `${e.slug}.json`);
  if (fs.existsSync(dest) && !REFRESH) continue;
  try {
    const distances = await reader.read(e.results.url);
    for (const d of Object.values(distances)) {
      d.times = d.times.filter(([t]) => t >= 600 && t <= 12 * 3600).sort((a, b) => a[0] - b[0]);
      d.finishers = d.times.length;
    }
    if (!Object.keys(distances).length) { skipped.push(`${e.slug} (no standard distances)`); continue; }
    fs.writeFileSync(dest, JSON.stringify({ slug: e.slug, source: reader.name, results_url: e.results.url, fetched: new Date().toISOString().slice(0, 10), distances }) + '\n');
    saved++;
    console.log(`saved ${e.slug}: ${Object.entries(distances).map(([k, d]) => `${k} ${d.finishers}`).join(', ')}`);
  } catch (err) {
    skipped.push(`${e.slug} (error: ${err.message})`);
  }
}
console.log(`\n${saved} race(s) saved. ${skipped.length} skipped (no reader yet or error):`);
for (const s of skipped) console.log('  ' + s);
