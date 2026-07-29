#!/usr/bin/env node
/**
 * validate-data.js
 *
 * Validates every JSON file under /data against the universal schema
 * (src/lib/schema) plus the active vertical's core_facts shape, checks for
 * duplicate ids/slugs, and cross-references category_id/region_id/
 * related_entity_ids so a broken internal link or orphan page is caught
 * here -- not after it's built and deployed.
 *
 * Run standalone (`npm run validate`), or as the first and last step of the
 * weekly-refresh pipeline (Step 8) so a bad AI response or bad scrape can
 * never corrupt /data silently. Exits non-zero on any schema/reference
 * error so CI fails loudly instead of shipping bad data.
 */
import siteConfig from '../src/lib/config.js';
import { getEntitySchema, categorySchema, regionSchema, listicleSchema } from '../src/lib/schema/index.js';
import { loadEntities, loadCategories, loadRegions, loadListicles, stripMeta } from '../src/lib/data.js';

let errorCount = 0;
let warningCount = 0;

function reportError(file, message) {
  errorCount++;
  console.error(`\n✗ ${file}\n  - ${message}`);
}

function reportZodError(file, zodError) {
  errorCount++;
  console.error(`\n✗ ${file}`);
  for (const issue of zodError.issues) {
    console.error(`  - ${issue.path.join('.') || '(root)'}: ${issue.message}`);
  }
}

function reportWarning(file, message) {
  warningCount++;
  console.warn(`\n⚠ ${file}\n  - ${message}`);
}

/** Validates a list of records against a schema, tracking duplicate ids/slugs. */
function validateList(items, schema, idField, label) {
  const seenIds = new Set();
  const seenSlugs = new Set();
  for (const item of items) {
    const data = stripMeta(item);
    const result = schema.safeParse(data);
    if (!result.success) {
      reportZodError(item.__file, result.error);
      continue;
    }
    const id = data[idField];
    if (seenIds.has(id)) {
      reportError(item.__file, `duplicate ${idField} across ${label}: "${id}"`);
    }
    seenIds.add(id);
    if (seenSlugs.has(data.slug)) {
      reportError(item.__file, `duplicate slug across ${label}: "${data.slug}"`);
    }
    seenSlugs.add(data.slug);
  }
  return seenIds;
}

const entitySchema = getEntitySchema(siteConfig.verticalKey);

const rawEntities = loadEntities();
const rawCategories = loadCategories();
const rawRegions = loadRegions();
const rawListicles = loadListicles();

const categoryIds = validateList(rawCategories, categorySchema, 'category_id', 'categories');
const regionIds = validateList(rawRegions, regionSchema, 'region_id', 'regions');
validateList(rawListicles, listicleSchema, 'listicle_id', 'listicles');
const entityIds = validateList(rawEntities, entitySchema, 'entity_id', 'entities');

// Cross-reference checks: catch orphan pages / broken internal links before
// they ever reach the built site (SEO requirement: "no orphan pages").
for (const item of rawEntities) {
  const data = stripMeta(item);
  if (data.category_id && !categoryIds.has(data.category_id)) {
    reportError(item.__file, `category_id "${data.category_id}" has no matching file in data/categories`);
  }
  if (data.region_id && !regionIds.has(data.region_id)) {
    reportError(item.__file, `region_id "${data.region_id}" has no matching file in data/regions`);
  }
  for (const relatedId of data.related_entity_ids ?? []) {
    if (!entityIds.has(relatedId)) {
      reportWarning(item.__file, `related_entity_ids references unknown entity "${relatedId}"`);
    }
  }
  // Atomic-answer SEO requirement: every FAQ should open with a direct
  // 40-60 word answer. Warn (don't fail the build) outside that range.
  for (const faq of data.faqs ?? []) {
    const wordCount = faq.answer.trim().split(/\s+/).filter(Boolean).length;
    if (wordCount < 30 || wordCount > 80) {
      reportWarning(item.__file, `FAQ answer is ${wordCount} words (target: a direct 40-60 word answer): "${faq.question}"`);
    }
  }
}

for (const item of rawRegions) {
  const data = stripMeta(item);
  if (data.parent_region_id && !regionIds.has(data.parent_region_id)) {
    reportError(item.__file, `parent_region_id "${data.parent_region_id}" has no matching file in data/regions`);
  }
}

for (const item of rawListicles) {
  const data = stripMeta(item);
  if (data.filters?.category_id && !categoryIds.has(data.filters.category_id)) {
    reportError(item.__file, `filters.category_id "${data.filters.category_id}" has no matching file in data/categories`);
  }
  if (data.filters?.region_id && !regionIds.has(data.filters.region_id)) {
    reportError(item.__file, `filters.region_id "${data.filters.region_id}" has no matching file in data/regions`);
  }
  for (const id of data.manual_entity_ids ?? []) {
    if (!entityIds.has(id)) {
      reportError(item.__file, `manual_entity_ids references unknown entity "${id}"`);
    }
  }
}

console.log(
  `\n${rawEntities.length} entities, ${rawCategories.length} categories, ${rawRegions.length} regions, ${rawListicles.length} listicles checked.`
);
console.log(`${errorCount} error(s), ${warningCount} warning(s).`);

if (errorCount > 0) {
  process.exit(1);
}
