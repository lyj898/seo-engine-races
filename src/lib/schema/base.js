import { z } from 'zod';

/**
 * Universal fields every entity/category/region/listicle has, in every
 * vertical. Nothing vertical-specific lives in this file -- that's the
 * whole point of the engine. Vertical differences live entirely in
 * `core_facts`, validated per-vertical via /src/lib/schema/core-facts.
 */

export const STATUS_VALUES = ['active', 'draft', 'needs_review', 'archived'];

// Lowercase kebab-case, used for entity_id/category_id/region_id/listicle_id
// AND slug -- keeping ids and slugs in the same format means URLs, file
// names, and ids can stay identical, which keeps routing (Step 4) simple.
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const slugSchema = z.string().regex(slugPattern, 'must be lowercase kebab-case, e.g. "half-marathon"');

export const sourceRefSchema = z.object({
  url: z.string().url(),
  label: z.string().min(1),
  type: z.enum(['official', 'registration_platform', 'aggregator', 'review', 'social', 'other']),
  last_checked: z.string().min(1).optional(), // ISO date string, e.g. "2026-07-20"
});

export const excerptQuoteSchema = z.object({
  quote: z.string().min(1).max(400),
  attribution: z.string().min(1),
  source_url: z.string().url().optional(),
});

export const faqSchema = z.object({
  question: z.string().min(1),
  // SEO requirement: every FAQ answer should open with a direct 40-60 word
  // answer before any elaboration. Word count isn't enforced here (too
  // brittle for a schema -- a good 39-word answer shouldn't fail a build)
  // but validate-data.js emits a warning outside that range so it gets
  // caught in review rather than silently shipping a bad FAQ.
  answer: z.string().min(1),
});

export const ctaLinkSchema = z.object({
  label: z.string().min(1),
  url: z.string().url(),
  // Free-form on purpose: matches site.config.json's primaryCTAType for the
  // main CTA, but an entity can carry secondary CTA types too (e.g. a race
  // might have "official_website" and "registration" both).
  type: z.string().min(1),
});

export const affiliateLinkSchema = z.object({
  label: z.string().min(1),
  url: z.string().url(),
  network: z.string().optional(),
  disclosure: z.string().optional(),
});

export const sentimentBreakdownItemSchema = z.object({
  // e.g. "Value for money", "Response time", "Lounge quality" -- the
  // vertical instance decides the labels via its seed data; the engine
  // itself has no opinion on what breakdown categories exist.
  label: z.string().min(1),
  score: z.number().min(0).max(100),
});

export const sentimentScoresSchema = z.object({
  overall: z.number().min(0).max(100),
  breakdown: z.array(sentimentBreakdownItemSchema).default([]),
});

export const baseEntitySchema = z.object({
  entity_id: z.string().min(1),
  slug: slugSchema,
  name: z.string().min(1),
  category_id: z.string().min(1),
  region_id: z.string().min(1),
  // One-sentence direct-answer intro, used as the entity page's opening
  // line and in listicle cards. Kept short deliberately.
  short_description: z.string().min(1).max(220),
  ai_summary: z.string().min(1),
  // Shape validated separately per verticalKey -- see
  // src/lib/schema/core-facts/index.js and getEntitySchema() below.
  core_facts: z.record(z.any()),
  pros: z.array(z.string().min(1)).default([]),
  cons: z.array(z.string().min(1)).default([]),
  sentiment_scores: sentimentScoresSchema.optional(),
  excerpt_quotes: z.array(excerptQuoteSchema).default([]),

  // Output of the web-research stage (scripts/research-entities.js), kept
  // deliberately separate from core_facts. core_facts is what a named
  // source page states and is re-verified weekly; these are what the wider
  // web says about the entity -- useful, but opinion rather than record.
  // Mixing the two would let commentary quietly acquire the authority of a
  // verified fact.
  //
  // zod strips undeclared keys on parse, so a stage that wants to persist
  // something new must declare it here first or the write silently drops it.
  research_highlights: z.array(z.string().min(1)).default([]),
  research_watchouts: z.array(z.string().min(1)).default([]),
  research_confidence: z.enum(['high', 'medium', 'low']).optional(),
  // ISO date of the last web-research pass. Drives the re-research
  // interval, and is separate from last_updated (which any stage bumps).
  research_last_updated: z.string().min(1).optional(),
  faqs: z.array(faqSchema).default([]),
  reliability_score: z.number().min(0).max(100),
  tags: z.array(z.string().min(1)).default([]),
  source_mix: z.array(sourceRefSchema).default([]),
  affiliate_links: z.array(affiliateLinkSchema).default([]),
  cta_links: z.array(ctaLinkSchema).default([]),
  related_entity_ids: z.array(z.string().min(1)).default([]),
  last_updated: z.string().min(1), // ISO date, e.g. "2026-07-29"
  status: z.enum(STATUS_VALUES),
});

export const categorySchema = z.object({
  category_id: z.string().min(1),
  slug: slugSchema,
  label: z.string().min(1), // display label, e.g. "Full Marathon" / "Marriott Bonvoy"
  short_description: z.string().min(1),
  intro: z.string().min(1).optional(), // longer unique hub-page intro paragraph
  related_category_ids: z.array(z.string()).default([]),
  faqs: z.array(faqSchema).default([]),
  // Optional numeric range [min, max|null] this category corresponds to on
  // whatever scale a vertical's core_facts uses a number for (e.g. race
  // distance in km, hotel star rating, course duration in hours). null max
  // means unbounded above. Lets a page classify a raw core_facts number
  // (e.g. one entry of races' distance_km array) against the nearest
  // matching category without any vertical-specific logic living in /src --
  // see src/lib/categoryMatch.js. Omit entirely for verticals/categories
  // that don't bucket entities along a numeric axis.
  matchRange: z.tuple([z.number(), z.number().nullable()]).optional(),
  // Optional visual-emphasis hint a vertical can set per category (e.g. the
  // marquee/most-searched option), used by pill/badge rendering wherever a
  // category label is shown as a chip. Purely presentational.
  badgeVariant: z.enum(['success', 'warning', 'neutral']).default('neutral'),
  last_updated: z.string().min(1),
  status: z.enum(STATUS_VALUES),
});

export const regionSchema = z.object({
  region_id: z.string().min(1),
  slug: slugSchema,
  label: z.string().min(1), // e.g. "Thailand" / "Nong Khai" / "Bangkok"
  // Free-form on purpose, but should use the vocabulary implied by
  // site.config.json.regionGranularity (e.g. "country", "city", "district").
  granularity: z.string().min(1),
  // Supports hierarchical regions (country -> city -> district) so a single
  // regionGranularity like "country+city" can have real parent/child pages
  // without the engine needing separate route types per level.
  parent_region_id: z.string().nullable().optional(),
  short_description: z.string().min(1),
  intro: z.string().min(1).optional(),
  faqs: z.array(faqSchema).default([]),
  last_updated: z.string().min(1),
  status: z.enum(STATUS_VALUES),
});

export const listicleFilterSchema = z.object({
  region_id: z.string().optional(),
  category_id: z.string().optional(),
  tags_any: z.array(z.string()).optional(),
  // Generic filter predicates over core_facts, so a listicle can express
  // vertical-specific conditions ("distance_km contains 42.195", "price
  // under X") without the engine needing per-vertical filter code.
  core_facts_filters: z
    .array(
      z.object({
        field: z.string().min(1),
        op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'contains']),
        value: z.any(),
      })
    )
    .optional(),
  sort_by: z.string().optional(),
  sort_direction: z.enum(['asc', 'desc']).optional(),
  limit: z.number().int().positive().optional(),
});

export const listicleSchema = z.object({
  listicle_id: z.string().min(1),
  slug: slugSchema,
  title: z.string().min(1),
  intro: z.string().min(1),
  filters: listicleFilterSchema,
  // Editorial pin/override: entities listed here are included regardless of
  // (or in addition to, per Step 4's implementation) the filters above. This
  // is what makes listicles "generated from structured filters + editorial
  // config, not written manually from scratch" -- editors add a filter and
  // optionally pin/exclude specific entities, they don't hand-write the list.
  manual_entity_ids: z.array(z.string()).default([]),
  editorial_notes: z.string().optional(),
  // A short, human-written callout naming the top pick(s) from this guide's
  // own ranked list and why -- the difference between a filtered calendar
  // and something that actually "recommends". Optional because not every
  // guide has been given one yet.
  editorial_pick: z.string().optional(),
  faqs: z.array(faqSchema).default([]),
  // Fingerprint of the entity set this guide's PROSE was written against
  // (listicleFingerprint in src/lib/listicles.js). The list itself resolves
  // live from `filters` every build, so it can't go stale -- the intro,
  // FAQs and editorial_pick can, and did, describing races that had since
  // been run and archived. Storing what the copy was written about lets the
  // renderer notice the drift and generate-listicles.js --refresh-stale fix
  // it. Optional: a guide written before this existed simply reads as stale,
  // which is the correct answer for it.
  source_fingerprint: z.string().optional(),
  // ISO date the prose above was last written. Distinct from last_updated,
  // which any stage bumps.
  copy_generated_at: z.string().optional(),
  last_updated: z.string().min(1),
  status: z.enum(STATUS_VALUES),
});

/**
 * Review articles (data/reviews/*.json).
 *
 * A long-form, review-led article about ONE entity -- the readable
 * counterpart to the entity page's structured facts. It synthesises the
 * same web-research material (quotes, sentiment, watchouts) into narrative
 * prose, and it is copyright-safe by construction:
 *
 *   - Body prose is original synthesis, never scraped paragraphs.
 *   - Any third-party wording appears only as a short, attributed
 *     `pull_quote` carrying a real source_url (same rule as excerpt_quotes).
 *   - Every factual claim is backed by a numbered `[n]` citation that maps
 *     to an entry in `sources`; the renderer turns each `[n]` into a link to
 *     the references list. validate-data.js checks every `[n]` resolves.
 *
 * One review references one entity via `entity_id` (cross-checked in
 * validate-data.js) so the article can pull live facts/breadcrumbs from the
 * entity instead of duplicating them.
 */
export const reviewSourceSchema = z.object({
  // Citation number referenced by `[n]` markers in section paragraphs.
  n: z.number().int().positive(),
  label: z.string().min(1), // e.g. "Race report" / "Runner race blog"
  publisher: z.string().min(1).optional(), // e.g. "ToughASIA"
  url: z.string().url(),
  type: z
    .enum(['official', 'registration_platform', 'aggregator', 'review', 'social', 'news', 'other'])
    .optional(),
});

export const reviewSectionSchema = z.object({
  heading: z.string().min(1),
  // Plain-text paragraphs. May contain inline `[n]` citation markers that
  // reference sources[].n -- the renderer linkifies them; nothing else in a
  // paragraph is ever treated as markup, so stored prose can't inject HTML.
  paragraphs: z.array(z.string().min(1)).min(1),
});

export const reviewSchema = z.object({
  review_id: z.string().min(1),
  slug: slugSchema,
  // The entity this article reviews. Cross-referenced in validate-data.js.
  entity_id: z.string().min(1),
  title: z.string().min(1), // on-page H1 (can be long/editorial)
  // SEO <title> (without the " | siteName" suffix the layout appends) and
  // meta description. Optional -- the page falls back to a derived title and
  // the dek. Kept short so the built <title>/description don't get truncated
  // in search results.
  seo_title: z.string().min(1).max(70).optional(),
  meta_description: z.string().min(1).max(200).optional(),
  dek: z.string().min(1), // standfirst / subtitle under the headline
  verdict: z.string().min(1), // the up-top "bottom line" paragraph
  // Optional at-a-glance scores, same shape as sentiment_scores -- typically
  // carried over from the entity's research so the two never disagree.
  rating: sentimentScoresSchema.optional(),
  sections: z.array(reviewSectionSchema).min(1),
  pull_quotes: z.array(excerptQuoteSchema).default([]),
  sources: z.array(reviewSourceSchema).min(1),
  faqs: z.array(faqSchema).default([]),
  editorial_notes: z.string().optional(),
  // Full ISO timestamp of when the article was generated, so the index can
  // sort strictly newest-first even when several publish on the same date
  // (last_updated is date-only). Optional: pre-timestamp reviews fall back to
  // last_updated for ordering.
  published_at: z.string().optional(),
  last_updated: z.string().min(1),
  status: z.enum(STATUS_VALUES),
});

/**
 * Gear articles (data/gear/*.json).
 *
 * Editorial buying-guide/advice content, independent of any single entity --
 * "what to bring", not "should you run this race". Reuses reviewSectionSchema
 * for body prose (same [n]-citation mechanics, so ReviewArticle.astro can
 * render a gear article's body with zero changes) and affiliateLinkSchema
 * for each recommended product's outbound link, so a product recommendation
 * is never a bare, undisclosed URL -- ProductCard.astro renders the same
 * "may earn a commission" disclosure CTABlock.astro already uses for
 * entity-level affiliate links, gated by the same
 * site.config.json.enabledFeatures.affiliateLinks flag.
 *
 * `sources` is optional (default []) unlike reviewSchema's required array:
 * a buying guide is allowed to be pure original advice with no external
 * citations, but if it does cite something, the same [n] rule and
 * validate-data.js resolution check apply.
 */
export const gearProductSchema = z.object({
  name: z.string().min(1), // product name, e.g. "Salomon ADV Skin 5 Hydration Vest"
  category: z.string().min(1), // e.g. "Hydration", "Lighting", "Apparel"
  why: z.string().min(1), // 1-3 sentence recommendation blurb
  price_range: z.string().min(1).optional(), // free-form, e.g. "$60-90"
  affiliate_link: affiliateLinkSchema,
});

export const gearArticleSchema = z.object({
  article_id: z.string().min(1),
  slug: slugSchema,
  title: z.string().min(1),
  seo_title: z.string().min(1).max(70).optional(),
  meta_description: z.string().min(1).max(200).optional(),
  // Groups articles into sections on the gear index page (e.g. "Heat &
  // Humidity", "Local Brands", "Travel"). Named `topic` rather than
  // `category` or `section` to avoid colliding with two other things in this
  // schema: the site's category_id/categoriesSupported content type (which
  // classifies entities, not gear articles, and doesn't need reusing here
  // since a topic label doesn't need its own hub page or matchRange) and
  // this same object's `sections` field below (the article's body prose).
  topic: z.string().min(1),
  dek: z.string().min(1),
  sections: z.array(reviewSectionSchema).min(1),
  products: z.array(gearProductSchema).default([]),
  sources: z.array(reviewSourceSchema).default([]),
  faqs: z.array(faqSchema).default([]),
  editorial_notes: z.string().optional(),
  published_at: z.string().optional(),
  last_updated: z.string().min(1),
  status: z.enum(STATUS_VALUES),
});

/**
 * General-purpose editorial articles (data/articles/*.json) -- "how to train
 * for a hot-weather marathon", "why Southeast Asian races start before
 * dawn", not a review of one entity (reviewSchema) or a product buying guide
 * (gearArticleSchema, which this otherwise mirrors minus `products`). Reuses
 * the same reviewSectionSchema/[n]-citation body-prose mechanics and
 * faqSchema as both of those, so ReviewArticle.astro renders this content
 * type with zero changes and validate-data.js's citation-resolution and FAQ-
 * length checks apply identically.
 *
 * `topic` groups articles into sections the same way gearArticleSchema's
 * `topic` does on the Gear index -- kept as a separate field here rather
 * than shared logic, since an articles-index page grouping by topic is a
 * page-layout concern, not a schema-sharing one.
 */
export const articleSchema = z.object({
  article_id: z.string().min(1),
  slug: slugSchema,
  title: z.string().min(1),
  seo_title: z.string().min(1).max(70).optional(),
  meta_description: z.string().min(1).max(200).optional(),
  topic: z.string().min(1),
  dek: z.string().min(1),
  sections: z.array(reviewSectionSchema).min(1),
  sources: z.array(reviewSourceSchema).default([]),
  faqs: z.array(faqSchema).default([]),
  editorial_notes: z.string().optional(),
  published_at: z.string().optional(),
  last_updated: z.string().min(1),
  status: z.enum(STATUS_VALUES),
});

/**
 * Travel agencies (data/travel-agencies/*.json) -- a directory, not
 * editorial content, so it deliberately does NOT reuse reviewSectionSchema/
 * ReviewArticle.astro the way gearArticleSchema and articleSchema do. Every
 * record here is a factual claim about a real third-party business, so the
 * schema is built around one hard rule: "certified" means a named major
 * race's own website (or the race organizer directly) actually lists this
 * agency as an official/authorized partner -- not that the agency merely
 * claims it. `certifications` is therefore required (min 1) and each entry
 * must carry the verifying source_url, mirroring reviewSourceSchema's
 * citation discipline but scoped per-claim rather than via [n] markers,
 * since this content has no body prose to cite into.
 *
 * `country` groups the directory the same way gearArticleSchema's/
 * articleSchema's `topic` groups their indexes.
 */
export const travelAgencyCertificationSchema = z.object({
  race_name: z.string().min(1), // e.g. "Boston Marathon"
  evidence: z.string().min(1), // e.g. "Listed as an official International Tour Operator on the Boston Athletic Association's own website"
  source_label: z.string().min(1), // e.g. "Boston Athletic Association -- International Tour Operators"
  source_url: z.string().url(),
});

export const travelAgencySchema = z.object({
  agency_id: z.string().min(1),
  slug: slugSchema,
  name: z.string().min(1),
  country: z.string().min(1),
  website: z.string().url(),
  description: z.string().min(1),
  certifications: z.array(travelAgencyCertificationSchema).min(1),
  contact_email: z.string().email().optional(),
  editorial_notes: z.string().optional(),
  last_updated: z.string().min(1),
  status: z.enum(STATUS_VALUES),
});
