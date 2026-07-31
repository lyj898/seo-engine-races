#!/usr/bin/env node
/**
 * summarize-changes.js
 *
 * Turns the raw git diff produced by a pipeline run into a human-readable
 * report: what was added, what was retired, what guides appeared.
 *
 * WHY THIS EXISTS
 * The pipeline commits straight to main, so nobody reads a diff before it
 * goes live. A 200-file commit titled "weekly refresh" tells the operator
 * nothing about whether the run did something sensible or something mad.
 * This turns the commit into a message worth reading: names, dates and
 * places rather than file paths.
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

  const headline =
    `Weekly refresh: ${added.length} added, ${archived.length} archived, ${newGuides.length} new guides`;

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

  const body = [
    `_Committed to \`main\` and deploying now._\n`,
    section('Races added', added, (e) => `- ${describeEntity(e)}`),
    section('Races archived', archived, (e) => `- ${describeEntity(e)}`),
    section('Races un-archived', unarchived, (e) => `- ${describeEntity(e)}`),
    section('New guides', newGuides, (l) => `- **${l.title}** — \`/best/${l.slug}/\``),
    otherEntityEdits
      ? `## Updated\n\n${otherEntityEdits} existing ${otherEntityEdits === 1 ? 'race' : 'races'} had facts or copy refreshed.\n`
      : '',
    added.length + archived.length + newGuides.length + otherEntityEdits === 0
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
