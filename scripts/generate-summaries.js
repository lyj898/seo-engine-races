#!/usr/bin/env node
/**
 * generate-summaries.js
 *
 * Calls the Claude API to generate ai_summary, short_description, pros,
 * cons, faqs, and (optionally) sentiment_scores for entities that still
 * carry discover-entities.js's PENDING_SUMMARY_MARKER placeholder --
 * strictly from that entity's own core_facts, tags, and excerpt_quotes.
 * Never invents facts (see scripts/lib/prompts.js's NO_INVENTION_RULE).
 *
 * Retries once (bounded) on a response that fails validation -- either
 * unparseable JSON (handled inside callClaudeForJson itself) or JSON that
 * parses fine but has an out-of-range FAQ/summary word count -- with a
 * corrective follow-up telling the model exactly what was wrong. If the
 * second attempt still fails, the entity is SKIPPED for this run (logged),
 * never written with bad data. Re-running `npm run validate` afterward is
 * an additional safety net independent of this script's own checks.
 *
 * On success, a "draft" entity is bumped to "needs_review" -- it now has
 * real content, but a human still promotes it to "active"
 * (enabledFeatures.reviewQueue). This script never sets status: "active".
 */
import fs from 'node:fs';

import siteConfig from '../src/lib/config.js';
import { getEntitySchema } from '../src/lib/schema/index.js';
import { loadEntities, stripMeta } from '../src/lib/data.js';

import { callClaudeForJson } from './lib/anthropic-client.js';
import { buildSummaryPrompt } from './lib/prompts.js';
import { PENDING_SUMMARY_MARKER } from './lib/constants.js';

const FAQ_WORD_MIN = 40;
const FAQ_WORD_MAX = 60;
// A little looser than the FAQ target range -- matches validate-data.js's
// own warning bound, so this script's bar is at least as strict as the
// final safety-net check, never looser.
const FAQ_WORD_MIN_LOOSE = 30;
const FAQ_WORD_MAX_LOOSE = 80;

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Returns a list of human-readable problems with a generated summary, or [] if it's fine. */
function findProblems(result) {
  const problems = [];
  if (!result || typeof result !== 'object') return ['response was not a JSON object'];

  if (typeof result.ai_summary !== 'string' || result.ai_summary.trim().length === 0) {
    problems.push('ai_summary is missing or empty');
  }
  if (typeof result.short_description !== 'string' || result.short_description.trim().length === 0) {
    problems.push('short_description is missing or empty');
  } else if (result.short_description.length > 220) {
    problems.push(`short_description is ${result.short_description.length} chars (max 220)`);
  }
  if (!Array.isArray(result.pros) || result.pros.length === 0) {
    problems.push('pros must be a non-empty array');
  }
  if (!Array.isArray(result.cons)) {
    problems.push('cons must be an array (may be empty)');
  }
  if (!Array.isArray(result.faqs) || result.faqs.length === 0) {
    problems.push('faqs must be a non-empty array');
  } else {
    for (const faq of result.faqs) {
      if (!faq?.question || !faq?.answer) {
        problems.push('a faq entry is missing question/answer');
        continue;
      }
      const count = wordCount(faq.answer);
      if (count < FAQ_WORD_MIN_LOOSE || count > FAQ_WORD_MAX_LOOSE) {
        problems.push(`faq answer is ${count} words (target ${FAQ_WORD_MIN}-${FAQ_WORD_MAX}): "${faq.question}"`);
      }
    }
  }
  return problems;
}

async function generateForEntity(entity) {
  const { system, prompt } = buildSummaryPrompt({ siteConfig, entity });
  let result = await callClaudeForJson({ system, prompt, maxTokens: 1800 });
  let problems = findProblems(result);

  if (problems.length > 0) {
    const correctivePrompt =
      `${prompt}\n\n---\nYour previous response had these problems: ${problems.join('; ')}. ` +
      `Respond again, fixing those issues, still grounded ONLY in the facts/quotes given above.`;
    result = await callClaudeForJson({ system, prompt: correctivePrompt, maxTokens: 1800 });
    problems = findProblems(result);
  }

  if (problems.length > 0) {
    throw new Error(`still invalid after retry: ${problems.join('; ')}`);
  }
  return result;
}

async function run() {
  const { verticalKey } = siteConfig;
  const entitySchema = getEntitySchema(verticalKey);

  const rawEntities = loadEntities();
  // Two independent signals count as "needs enrichment": the explicit
  // discover-entities.js placeholder, OR an entity that simply has no
  // pros/cons/faqs content yet at all (covers entities brought in by a bulk
  // migration -- e.g. from an existing spreadsheet/legacy site -- that have
  // solid structured core_facts and a real summary, but were never run
  // through this pipeline for the editorial layer). Either way, an entity
  // with real pros/cons/faqs already is left alone -- this never overwrites
  // existing enrichment.
  const targets = rawEntities.filter((e) => {
    const entity = stripMeta(e);
    const isPending = entity.ai_summary === PENDING_SUMMARY_MARKER;
    const isBare = (entity.pros?.length ?? 0) === 0 && (entity.cons?.length ?? 0) === 0 && (entity.faqs?.length ?? 0) === 0;
    return isPending || isBare;
  });

  if (targets.length === 0) {
    console.log('[generate-summaries] no entities need enrichment (everything has pros/cons/faqs, or is not pending).');
    return;
  }

  const stats = { generated: 0, skipped: 0 };

  for (const raw of targets) {
    const entity = stripMeta(raw);
    let result;
    try {
      result = await generateForEntity(entity);
    } catch (err) {
      console.warn(`[generate-summaries] ${entity.slug}: ${err.message} -- skipping, left as pending.`);
      stats.skipped++;
      continue;
    }

    const updated = {
      ...entity,
      ai_summary: result.ai_summary.trim(),
      short_description: result.short_description.trim().slice(0, 220),
      pros: result.pros.map((p) => String(p).trim()).filter(Boolean),
      cons: (result.cons ?? []).map((c) => String(c).trim()).filter(Boolean),
      faqs: result.faqs.map((f) => ({ question: String(f.question).trim(), answer: String(f.answer).trim() })),
      // status was "draft" (freshly discovered, no summary yet) -- now it has
      // real content, so it graduates to "needs_review" for a human to
      // promote to "active". If it was already further along
      // (needs_review/active/archived), leave status exactly as-is.
      status: entity.status === 'draft' ? 'needs_review' : entity.status,
    };
    if (result.sentiment_scores && typeof result.sentiment_scores === 'object') {
      updated.sentiment_scores = result.sentiment_scores;
    }

    const validation = entitySchema.safeParse(updated);
    if (!validation.success) {
      console.warn(
        `[generate-summaries] ${entity.slug}: generated content failed schema validation, NOT writing: ${validation.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`
      );
      stats.skipped++;
      continue;
    }

    fs.writeFileSync(new URL(`../${raw.__file}`, import.meta.url), JSON.stringify(validation.data, null, 2) + '\n');
    console.log(`[generate-summaries] ${entity.slug}: summary generated, status -> ${updated.status}.`);
    stats.generated++;
  }

  console.log(`\n[generate-summaries] done. Generated: ${stats.generated}, skipped: ${stats.skipped}.`);
}

run().catch((err) => {
  console.error('[generate-summaries] fatal error:', err);
  process.exit(1);
});
