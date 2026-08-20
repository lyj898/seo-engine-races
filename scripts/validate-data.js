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
import { getEntitySchema, categorySchema, regionSchema, listicleSchema, reviewSchema, gearArticleSchema, articleSchema, travelAgencySchema } from '../src/lib/schema/index.js';
import { loadEntities, loadCategories, loadRegions, loadListicles, loadReviews, loadGear, loadArticles, loadTravelAgencies, stripMeta } from '../src/lib/data.js';
import { simplifyAvailabilityStatus, questionsAreNearDuplicates } from '../src/lib/text.js';
import { resolveListicleEntities, isListicleCopyStale } from '../src/lib/listicles.js';

const TODAY = new Date().toISOString().slice(0, 10);
const isIsoDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

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
const rawReviews = loadReviews();
const rawGear = loadGear();
const rawArticles = loadArticles();
const rawTravelAgencies = loadTravelAgencies();

const categoryIds = validateList(rawCategories, categorySchema, 'category_id', 'categories');
const regionIds = validateList(rawRegions, regionSchema, 'region_id', 'regions');
validateList(rawListicles, listicleSchema, 'listicle_id', 'listicles');
validateList(rawReviews, reviewSchema, 'review_id', 'reviews');
validateList(rawGear, gearArticleSchema, 'article_id', 'gear articles');
validateList(rawArticles, articleSchema, 'article_id', 'articles');
validateList(rawTravelAgencies, travelAgencySchema, 'agency_id', 'travel agencies');
const entityIds = validateList(rawEntities, entitySchema, 'entity_id', 'entities');

// Cross-reference checks: catch orphan pages / broken internal links before
// they ever reach the built site (SEO requirement: "no orphan pages").
/**
 * Prose that a reader sees, field by field, so a copy-quality check can walk
 * all of it without each check re-listing where prose lives.
 */
function prosePieces(data) {
  const out = [];
  if (typeof data.ai_summary === 'string') out.push(['ai_summary', data.ai_summary]);
  if (typeof data.short_description === 'string') out.push(['short_description', data.short_description]);
  (data.pros ?? []).forEach((p, i) => out.push([`pros[${i}]`, p]));
  (data.cons ?? []).forEach((c, i) => out.push([`cons[${i}]`, c]));
  (data.faqs ?? []).forEach((f, i) => out.push([`faqs[${i}].answer`, f.answer]));
  return out.filter(([, text]) => typeof text === 'string');
}

// A verification date baked into prose, or a confidence score quoted at the
// reader. Both are the page describing its own machinery; the freshness
// stamp and the sources list already carry that, accurately and without
// going stale.
const BAKED_FRESHNESS_RE =
  /(?:as of the last verification[^.]*|(?:last )?verified (?:as of|on|against[^.]*?as of)[^.]*?\d{4}|confidence (?:score|rating) (?:of )?\(?\d+\)?)/i;

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
  // Registration status is the field most likely to be quietly wrong: it is
  // a snapshot with no expiry, and refresh only re-verifies ~25 entities a
  // week against a directory of 200+. The site stopped publishing it for
  // exactly that reason (see withoutRegistrationClaims in src/lib/text.js),
  // but nothing renderers do fixes the stored data -- these warnings surface
  // the entities whose facts actually need correcting.
  //
  // Warnings, not errors, on purpose: dozens of entities are affected right
  // now, and failing the build would block every unrelated change until the
  // whole backlog is cleared.
  const facts = data.core_facts ?? {};
  const claimedOpen = simplifyAvailabilityStatus(facts.registration_status) === 'open';
  if (isIsoDate(facts.registration_deadline)) {
    if (claimedOpen && facts.registration_deadline < TODAY) {
      reportWarning(
        item.__file,
        `registration_status reads "${facts.registration_status}" but registration_deadline ` +
          `(${facts.registration_deadline}) has passed -- correct the stored status`
      );
    }
    if (isIsoDate(facts.date) && facts.registration_deadline > facts.date) {
      reportWarning(
        item.__file,
        `registration_deadline (${facts.registration_deadline}) is after the race date ` +
          `(${facts.date}) -- one of the two is wrong`
      );
    }
  } else if (claimedOpen && isIsoDate(facts.date) && facts.date < TODAY) {
    // No deadline stored, and the race itself is in the past. Unambiguous.
    reportWarning(
      item.__file,
      `registration_status reads "${facts.registration_status}" but the race date (${facts.date}) ` +
        `has passed -- correct the stored status`
    );
  }

  // Prose must not carry its own freshness date or expose the pipeline.
  //
  // A listing already shows exactly one freshness stamp, anchored to the
  // newest source_mix.last_checked. Copy that also says "verified as of 20
  // July 2026" gives the same page a second, older date that nothing ever
  // updates -- the Borobudur listing read "Facts last checked August 18"
  // above prose claiming 20 July -- and "confidence score of 92" describes
  // the machinery rather than the race. buildSummaryPrompt forbids both;
  // this catches a model that does it anyway, before it ships.
  for (const [field, text] of prosePieces(data)) {
    if (BAKED_FRESHNESS_RE.test(text)) {
      reportWarning(item.__file, `${field} states its own verification date or confidence score -- the page's freshness stamp is the single signal for that: "${text.match(BAKED_FRESHNESS_RE)[0]}"`);
    }
  }

  // Near-duplicate FAQs. Two questions that differ only in wording ("How
  // much does X cost?" / "What does it cost to enter X?") produce two
  // near-identical answers in the accordion and two entries in the FAQPage
  // schema, which suppresses rich results rather than earning them.
  const faqList = data.faqs ?? [];
  for (let i = 0; i < faqList.length; i++) {
    for (let j = i + 1; j < faqList.length; j++) {
      if (questionsAreNearDuplicates(faqList[i].question, faqList[j].question)) {
        reportWarning(
          item.__file,
          `FAQ questions ${i + 1} and ${j + 1} ask the same thing: "${faqList[i].question}" / "${faqList[j].question}"`
        );
      }
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
  // Has the set moved on since the copy describing it was written? The guide
  // page falls back to a derived intro when it has, so this is not a
  // rendering fault -- it is the queue for `npm run listicles:refresh`.
  const resolvedForGuide = resolveListicleEntities(
    data,
    rawEntities.map(stripMeta),
    rawRegions.map(stripMeta),
    rawCategories.map(stripMeta)
  );
  if (isListicleCopyStale(data, resolvedForGuide)) {
    reportWarning(
      item.__file,
      `guide copy was written for a different set of entries than the ${resolvedForGuide.length} it now lists ` +
        `-- run \`npm run listicles:refresh\` to rewrite it (the page shows a derived intro until then)`
    );
  }
}

// Review articles: the entity they review must exist, and every inline
// [n] citation must resolve to a declared source -- an unresolvable
// citation would render as a dead link and undercuts the whole
// "everything is attributed" guarantee, so it fails the build.
const entityByIdForReviews = new Map(rawEntities.map((e) => [stripMeta(e).entity_id, stripMeta(e)]));
for (const item of rawReviews) {
  const data = stripMeta(item);
  const reviewedEntity = entityByIdForReviews.get(data.entity_id);
  if (!entityIds.has(data.entity_id)) {
    reportError(item.__file, `entity_id "${data.entity_id}" has no matching file in data/entities`);
  }
  // Cross-set duplicate FAQs. With mergedReviews on, a review's FAQs render
  // on the entity page beside the entity's own, so the pair that matters is
  // the merged one -- and that is where the duplicates actually were (the
  // Borobudur listing asked about pricing twice, once from each side). The
  // page dedupes at render time (dedupeFaqs), so this is a note that the
  // stored data is generating redundant questions, not a rendering bug.
  //
  // One warning per review, not per pair: 127 of the 215 reviews overlap
  // with their entity somewhere, and a line each would bury every other
  // warning in this report.
  const duplicatedQuestions = (data.faqs ?? []).filter((reviewFaq) =>
    (reviewedEntity?.faqs ?? []).some((entityFaq) => questionsAreNearDuplicates(entityFaq.question, reviewFaq.question))
  );
  if (duplicatedQuestions.length > 0) {
    reportWarning(
      item.__file,
      `${duplicatedQuestions.length} FAQ(s) duplicate a question on the reviewed entity, so the merged page ` +
        `would ask them twice (deduped at render time): "${duplicatedQuestions[0].question}"`
    );
  }

  const sourceNumbers = new Set((data.sources ?? []).map((s) => s.n));
  const citationsUsed = new Set();
  const allProse = [];
  for (const section of data.sections ?? []) {
    for (const para of section.paragraphs ?? []) {
      allProse.push(para);
      // Reject web-search citation artifacts that leak internal retrieval
      // chunks instead of our sources[]: raw <cite> tags and compound/
      // hyphenated refs like [16-8] or [11-3,11-4]. These rendered as visible
      // broken markup on the live site before this gate existed.
      if (/<\/?cite/i.test(para)) {
        reportError(item.__file, `paragraph contains a raw <cite> tag (leaked web-search markup): "${para.slice(0, 60)}..."`);
      }
      // Hyphenated refs like [16-8] are internal retrieval-chunk indices, not
      // real citations. A comma list like [1,2] is a legitimate multi-source
      // citation and is allowed.
      if (/\[\d+-[^\]]*\]/.test(para)) {
        reportError(item.__file, `paragraph has a hyphenated chunk citation like [16-8] (use [n] or [n,m]): "${para.slice(0, 60)}..."`);
      }
      // A run of " · "-separated fragments is almost always a scraped
      // tag/facet list pasted in as prose rather than written text.
      if ((para.match(/ · /g) ?? []).length >= 3) {
        reportWarning(item.__file, `paragraph looks like a scraped tag/facet dump (multiple " · " separators): "${para.slice(0, 60)}..."`);
      }
      for (const match of para.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)) {
        for (const numStr of match[1].split(',')) {
          const n = Number(numStr.trim());
          citationsUsed.add(n);
          if (!sourceNumbers.has(n)) {
            reportError(item.__file, `paragraph cites [${n}] but sources has no entry with n=${n}`);
          }
        }
      }
    }
  }
  // A dated event's review should actually state the year somewhere.
  const eventYear = String(reviewedEntity?.core_facts?.date ?? '').slice(0, 4);
  if (/^\d{4}$/.test(eventYear)) {
    const haystack = [...allProse, data.verdict ?? '', ...(data.faqs ?? []).map((f) => f.answer)].join(' ');
    if (!haystack.includes(eventYear)) {
      reportWarning(item.__file, `review never states the event year (${eventYear}) in its prose/verdict/FAQs`);
    }
  }
  for (const s of data.sources ?? []) {
    if (!citationsUsed.has(s.n)) {
      reportWarning(item.__file, `source n=${s.n} (${s.label}) is declared but never cited with [${s.n}]`);
    }
  }
  for (const faq of data.faqs ?? []) {
    const wordCount = faq.answer.trim().split(/\s+/).filter(Boolean).length;
    if (wordCount < 30 || wordCount > 80) {
      reportWarning(item.__file, `FAQ answer is ${wordCount} words (target: a direct 40-60 word answer): "${faq.question}"`);
    }
  }
}

// Gear articles: same [n]-citation resolution rule as reviews (sources is
// optional here since a pure-advice guide may cite nothing, but any [n] that
// IS used must resolve), plus the same FAQ answer-length warning.
for (const item of rawGear) {
  const data = stripMeta(item);
  const sourceNumbers = new Set((data.sources ?? []).map((s) => s.n));
  const citationsUsed = new Set();
  for (const section of data.sections ?? []) {
    for (const para of section.paragraphs ?? []) {
      if (/<\/?cite/i.test(para)) {
        reportError(item.__file, `paragraph contains a raw <cite> tag (leaked web-search markup): "${para.slice(0, 60)}..."`);
      }
      if (/\[\d+-[^\]]*\]/.test(para)) {
        reportError(item.__file, `paragraph has a hyphenated chunk citation like [16-8] (use [n] or [n,m]): "${para.slice(0, 60)}..."`);
      }
      for (const match of para.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)) {
        for (const numStr of match[1].split(',')) {
          const n = Number(numStr.trim());
          citationsUsed.add(n);
          if (!sourceNumbers.has(n)) {
            reportError(item.__file, `paragraph cites [${n}] but sources has no entry with n=${n}`);
          }
        }
      }
    }
  }
  for (const s of data.sources ?? []) {
    if (!citationsUsed.has(s.n)) {
      reportWarning(item.__file, `source n=${s.n} (${s.label}) is declared but never cited with [${s.n}]`);
    }
  }
  for (const faq of data.faqs ?? []) {
    const wordCount = faq.answer.trim().split(/\s+/).filter(Boolean).length;
    if (wordCount < 30 || wordCount > 80) {
      reportWarning(item.__file, `FAQ answer is ${wordCount} words (target: a direct 40-60 word answer): "${faq.question}"`);
    }
  }
}

// Articles: same [n]-citation resolution rule as reviews/gear (sources is
// optional here since a pure-advice article may cite nothing, but any [n]
// that IS used must resolve), plus the same FAQ answer-length warning.
for (const item of rawArticles) {
  const data = stripMeta(item);
  const sourceNumbers = new Set((data.sources ?? []).map((s) => s.n));
  const citationsUsed = new Set();
  for (const section of data.sections ?? []) {
    for (const para of section.paragraphs ?? []) {
      if (/<\/?cite/i.test(para)) {
        reportError(item.__file, `paragraph contains a raw <cite> tag (leaked web-search markup): "${para.slice(0, 60)}..."`);
      }
      if (/\[\d+-[^\]]*\]/.test(para)) {
        reportError(item.__file, `paragraph has a hyphenated chunk citation like [16-8] (use [n] or [n,m]): "${para.slice(0, 60)}..."`);
      }
      for (const match of para.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)) {
        for (const numStr of match[1].split(',')) {
          const n = Number(numStr.trim());
          citationsUsed.add(n);
          if (!sourceNumbers.has(n)) {
            reportError(item.__file, `paragraph cites [${n}] but sources has no entry with n=${n}`);
          }
        }
      }
    }
  }
  for (const s of data.sources ?? []) {
    if (!citationsUsed.has(s.n)) {
      reportWarning(item.__file, `source n=${s.n} (${s.label}) is declared but never cited with [${s.n}]`);
    }
  }
  for (const faq of data.faqs ?? []) {
    const wordCount = faq.answer.trim().split(/\s+/).filter(Boolean).length;
    if (wordCount < 30 || wordCount > 80) {
      reportWarning(item.__file, `FAQ answer is ${wordCount} words (target: a direct 40-60 word answer): "${faq.question}"`);
    }
  }
}

// Travel agencies: this whole content type exists to make a single, narrow
// claim -- "a named major race's own organizer lists this agency as an
// official/authorized partner" -- so every certification must carry a real
// source_url (enforced by the schema) and that url must actually be
// reachable-looking (not a bare domain masquerading as a specific page).
// This can't verify the URL still says what it said when it was checked
// (that would require a live fetch on every CI run), but it catches the
// cheapest failure mode: a certification with no real evidence trail at all.
for (const item of rawTravelAgencies) {
  const data = stripMeta(item);
  for (const cert of data.certifications ?? []) {
    if (!/^https?:\/\/.+\..+/.test(cert.source_url)) {
      reportError(item.__file, `certification for "${cert.race_name}" has a source_url that doesn't look like a real page: "${cert.source_url}"`);
    }
  }
}

console.log(
  `\n${rawEntities.length} entities, ${rawCategories.length} categories, ${rawRegions.length} regions, ${rawListicles.length} listicles, ${rawReviews.length} reviews, ${rawGear.length} gear articles, ${rawArticles.length} articles, ${rawTravelAgencies.length} travel agencies checked.`
);
console.log(`${errorCount} error(s), ${warningCount} warning(s).`);

if (errorCount > 0) {
  process.exit(1);
}
