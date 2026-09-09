#!/usr/bin/env node
/**
 * summarize-changes.js
 *
 * Turns the raw git diff produced by a run into a human-readable report:
 * what was retired, and -- for a hand-run pass that goes through this same
 * script -- what was added and what guides appeared.
 *
 * WHY THIS EXISTS
 * The run commits straight to main, so nobody reads a diff before it goes
 * live. A commit titled "weekly refresh" tells the operator nothing about
 * whether the run did something sensible or something mad. This turns the
 * commit into a message worth reading: names, dates and places rather than
 * file paths.
 *
 * The weekly workflow now only archives lapsed races, so most of the
 * sections below stay empty on a scheduled run. They are kept because this
 * script is also what reports a manual discovery or summaries pass, and
 * because a section that appears when something unexpected happened is worth
 * more than one deleted for tidiness.
 *
 * Reads the working tree against HEAD, so it must run BEFORE the commit
 * step. Writes markdown to the path given as --out (default
 * `refresh-summary.md`) and a one-line headline to stdout for the
 * workflow to use as an issue title.
 *
 * Deliberately does no network or AI work: if this script itself breaks, it
 * should cost a nice notification, never a failed data run.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const OUT = (() => {
  const i = process.argv.indexOf('--out');
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : 'refresh-summary.md';
})();

const git = (cmd) => execSync(cmd, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

/** File contents at HEAD, or null if the file is newly added. */
function atHead(path) {
  try {
    return JSON.parse(git(`git show HEAD:"${path}"`));
  } catch {
    return null;
  }
}

function current(path) {
  try {
    return JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function describeEntity(e) {
  const f = e.core_facts ?? {};
  const where = [f.city, f.country].filter(Boolean).join(', ');
  const bits = [f.date, where].filter(Boolean).join(' — ');
  return bits ? `**${e.name}** (${bits})` : `**${e.name}**`;
}

function run() {
  // --porcelain gives "XY path"; -z would be safer for exotic filenames but
  // every path here is a slug we generated ourselves.
  const lines = git('git status --porcelain -- data/').split('\n').map((l) => l.trim()).filter(Boolean);

  const added = [];
  const archived = [];
  const unarchived = [];
  const newGuides = [];
  let otherEntityEdits = 0;

  for (const line of lines) {
    const status = line.slice(0, 2).trim();
    const path = line.slice(2).trim().replace(/^"|"$/g, '');

    if (path.startsWith('data/entities/')) {
      const now = current(path);
      if (!now) continue;
      if (status === '??' || status === 'A') {
        added.push(now);
        continue;
      }
      const before = atHead(path);
      if (before && before.status !== now.status) {
        if (now.status === 'archived') archived.push(now);
        else if (before.status === 'archived') unarchived.push(now);
        else otherEntityEdits++;
      } else {
        otherEntityEdits++;
      }
    } else if (path.startsWith('data/listicles/') && (status === '??' || status === 'A')) {
      const now = current(path);
      if (now) newGuides.push(now);
    }
  }

  // Source health, from the report discover-entities.js drops at the repo
  // root. The weekly workflow no longer runs discovery, so this file is
  // normally absent and the whole section disappears -- which is correct:
  // reporting on sources nothing read this run would be noise. It still
  // renders for a hand-run discovery pass. Read defensively: a missing or
  // malformed file must degrade to "no section" rather than break the
  // notification, which is the one thing the operator actually reads.
  //
  // This section exists because a dead source is invisible otherwise. Four of
  // them (three ahotu.com URLs and checkpointspot.asia) returned 403 for weeks
  // while every notification still said "0 added" -- indistinguishable from
  // "nothing new to find". The failure count goes in the headline so it cannot
  // be missed without opening the issue.
  let sourceReport = null;
  try {
    sourceReport = JSON.parse(fs.readFileSync('.pipeline-source-report.json', 'utf8'));
  } catch {
    sourceReport = null;
  }
  const sources = Array.isArray(sourceReport?.sources) ? sourceReport.sources : [];
  // Two very different failures, kept apart because they need different
  // actions. kind 'source' means the site would not give us the page (403,
  // 404, robots) -- fix the source list. kind 'pipeline' means we got the page
  // but our own extraction call failed -- usually a transient API problem, and
  // reporting an API outage as "18 sources failing" would send someone off
  // rewriting a perfectly good config.
  const unreachable = sources.filter((s) => s && !s.ok && s.kind !== 'pipeline');
  const extractionFailed = sources.filter((s) => s && !s.ok && s.kind === 'pipeline');

  // Archived leads and is always stated, because archiving is the only thing
  // the weekly workflow does now -- "0 archived" is a real result worth
  // reading, not a placeholder. The others are stated only when non-zero:
  // they can still happen (a hand-run discovery pass committed through this
  // same script), but a headline permanently carrying "0 added, 0 new guides"
  // trains the reader to skip the line that matters.
  const headline =
    `Weekly refresh: ${archived.length} archived` +
    (added.length > 0 ? `, ${added.length} added` : '') +
    (unarchived.length > 0 ? `, ${unarchived.length} un-archived` : '') +
    (newGuides.length > 0 ? `, ${newGuides.length} new guides` : '') +
    (unreachable.length > 0 ? `, ${unreachable.length} source(s) UNREACHABLE` : '') +
    (extractionFailed.length > 0 ? `, ${extractionFailed.length} extraction failure(s)` : '');

  // GitHub rejects an issue body over 65,536 characters, and a first run or a
  // newly-added source can legitimately produce hundreds of additions. Cap
  // each list and state the remainder rather than risk the whole
  // notification failing on the one run that most needed reading.
  const MAX_LISTED = 60;
  const section = (title, items, render) => {
    if (!items.length) return '';
    const shown = items.slice(0, MAX_LISTED).map(render).join('\n');
    const rest = items.length - MAX_LISTED;
    const more = rest > 0 ? `\n- _…and ${rest} more_` : '';
    return `## ${title} (${items.length})\n\n${shown}${more}\n`;
  };

  // Failures first: if discovery could only read half its sources, that
  // changes how every count below should be read.
  const sourceSection = (() => {
    if (sources.length === 0) return '';
    if (unreachable.length === 0 && extractionFailed.length === 0) {
      return `## Sources\n\nAll ${sources.length} sources read OK.\n`;
    }
    const list = (items) => items.slice(0, MAX_LISTED).map((s) => `- \`${s.url}\` — ${s.reason}`).join('\n');
    const out = [];
    if (unreachable.length > 0) {
      out.push(
        `## ⚠️ Sources unreachable (${unreachable.length} of ${sources.length})\n\n` +
          `${list(unreachable)}\n\n` +
          `These sites would not serve us the page, so they contributed nothing ` +
          `and the counts below understate what is out there. Fix or replace them ` +
          `in \`site.config.json\` → \`sourceConfig.trustedAggregators\`.\n`
      );
    }
    if (extractionFailed.length > 0) {
      out.push(
        `## Extraction failures (${extractionFailed.length} of ${sources.length})\n\n` +
          `${list(extractionFailed)}\n\n` +
          `The page loaded but our own extraction call did not return usable ` +
          `candidates. Usually transient — if it persists across runs, check the ` +
          `API key and rate limits before touching the source list.\n`
      );
    }
    return out.join('\n');
  })();

  const body = [
    `_Committed to \`main\` and deploying now._\n`,
    sourceSection,
    section('Races added', added, (e) => `- ${describeEntity(e)}`),
    section('Races archived', archived, (e) => `- ${describeEntity(e)}`),
    section('Races un-archived', unarchived, (e) => `- ${describeEntity(e)}`),
    section('New guides', newGuides, (l) => `- **${l.title}** — \`/best/${l.slug}/\``),
    otherEntityEdits
      ? `## Also edited\n\n${otherEntityEdits} existing ${otherEntityEdits === 1 ? 'race' : 'races'} changed without changing status.\n`
      : '',
    added.length + archived.length + unarchived.length + newGuides.length + otherEntityEdits === 0
      ? '_Nothing changed this run._\n'
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  fs.writeFileSync(OUT, `# ${headline}\n\n${body}`);

  // Headline goes to stdout for the workflow to capture as the issue title.
  process.stdout.write(headline);
}

run();
