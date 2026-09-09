#!/usr/bin/env node
/**
 * archive-lapsed.js
 *
 * Archives every published entity whose date has already passed. That is the
 * entire job.
 *
 * WHY THIS EXISTS AS ITS OWN SCRIPT
 * This one rule was previously the first few lines of refresh-entities.js,
 * which then went on to fetch each source page and ask Claude whether the
 * stored facts still held. That made a free, offline, deterministic
 * housekeeping task a passenger on an expensive one: when the API key ran out
 * of credit, every listing kept its stale "active" status because the run it
 * was riding on had failed around it. Splitting it out means the weekly
 * workflow needs no key, no network and no model -- it reads dates and writes
 * a status, and cannot fail for any reason that isn't a real data problem.
 *
 * refresh-entities.js still exists and still archives lapsed entities itself,
 * for anyone running the full re-verification pass by hand. Both read the
 * SAME predicate (isLapsed in src/lib/succession.js -- also what every page
 * uses to decide whether to present a race as upcoming), so the pipeline and
 * the site can't disagree about what "already happened" means. That is true
 * as of this commit and was not before it: refresh-entities.js carried its
 * own inline `date < today`, which lacks isLapsed's "looks like a full ISO
 * date" guard and so archived malformed dates the site still showed as
 * upcoming. If a third caller ever needs this, import it -- do not re-derive
 * it.
 *
 * A lapsed race is the one status change that needs no human in the loop: no
 * source can un-happen it, unlike "the organiser's page now says cancelled",
 * which stays an editorial call and is what needs_review is for.
 *
 * Flags:
 *   --dry-run  report what would be archived, write nothing.
 */
import siteConfig from '../src/lib/config.js';
import { getEntitySchema } from '../src/lib/schema/index.js';
import { loadEntities, stripMeta } from '../src/lib/data.js';
import { isLapsed } from '../src/lib/succession.js';
import { writeIfValid } from './lib/write-entity.js';

const DRY_RUN = process.argv.includes('--dry-run');

function run() {
  const today = new Date().toISOString().slice(0, 10);
  const entitySchema = getEntitySchema(siteConfig.verticalKey);

  const stats = { checked: 0, archived: 0, invalidSkipped: 0 };

  for (const raw of loadEntities()) {
    const entity = stripMeta(raw);
    // Only listings the site actually presents. An archived one is already
    // done; a draft has never been published, so ageing it out would hide a
    // record nobody has reviewed yet rather than retire a live one.
    if (!['active', 'needs_review'].includes(entity.status)) continue;
    stats.checked++;

    if (!isLapsed(entity, today)) continue;

    const updated = { ...entity, status: 'archived', last_updated: today };
    if (writeIfValid(raw.__file, updated, entitySchema, 'archive-lapsed', { dryRun: DRY_RUN })) {
      stats.archived++;
      console.log(`[archive-lapsed] ${entity.slug}: ran ${entity.core_facts.date} -> archived.`);
    } else {
      stats.invalidSkipped++;
    }
  }

  console.log(
    `\n[archive-lapsed] done${DRY_RUN ? ' (DRY RUN -- nothing written)' : ''}. ` +
      `Checked: ${stats.checked}, archived: ${stats.archived}, ` +
      `invalid (skipped write): ${stats.invalidSkipped}.`
  );
}

run();
