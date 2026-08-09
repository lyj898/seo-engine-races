# programmatic-seo-engine

A reusable, config-driven Astro engine for programmatic-SEO directory sites.
Nothing vertical-specific ("race", "hotel", "course", "provider", "vendor")
is ever hardcoded into routes, schema, or templates. Every vertical is a
matter of changing `site.config.json`, the schema extensions, seed data, AI
prompt templates, and source-discovery config -- never the shared engine code.

**First live vertical: races**, targeting `runsea.run`. Modeled on the
structure of the existing `runsea.run` MVP, but rebuilt cleaner and made
generic enough to power hotels, local services, courses, and event-planning
vendor sites from the same codebase.

## Build sequence (stop-and-review after each step)

- [x] **Step 1 -- Scaffold repo and config architecture**
- [x] **Step 2 -- Universal schema and seed data format**
- [x] **Step 3 -- Core layouts and shared components**
- [x] **Step 4 -- Dynamic routes (region / category / entity / listicle)**
- [x] **Step 5 -- First working vertical: races (real seed data)**
- [x] **Step 6 -- Schema.org markup, sitemap, robots.txt (config-driven)**
- [x] **Step 7 -- GitHub Pages deploy workflow**
- [x] **Step 8 -- Weekly refresh workflow (Claude API research pipeline)**
- [x] **Step 9 -- AI prompt templates + JSON validation**
- [x] **Step 10 -- Hardcoded-vertical-word audit / cleanup**

## Repo layout

```
site.config.json        <- the ONLY place vertical labels/branding/behavior live
package.json
astro.config.mjs        <- reads `site` from site.config.json
/config-examples         <- reference configs for the other 4 verticals (inert)
/public
  CNAME                   <- runsea.run (live)
/src
  /layouts                <- shared page shells (Step 3)
  /components             <- facts table, pros/cons, FAQ, CTA, breadcrumb, etc.
  /pages                  <- Astro routes / getStaticPaths (Step 4)
  /lib                    <- config loader, schema, shared helpers
  /styles                 <- Tailwind base + design tokens (from site.config.json.theme)
/data
  /entities               <- one JSON file per entity (race, hotel, course...)
  /regions
  /categories
  /listicles
  /_raw                   <- git-ignored scratch space for raw scrapes (never published)
/scripts
  discover-entities.js    <- Step 9: find new entities via sourceConfig + Claude API
  refresh-entities.js     <- Step 9: re-verify/update existing entities
  generate-summaries.js   <- Step 9: ai_summary / pros / cons / faqs
  validate-data.js        <- Step 2/9: schema validation, safe to run standalone
  /lib                    <- Step 9: shared, vertical-agnostic helpers (see below)
    slugify.js              kebab-case slugs matching src/lib/schema's slugSchema
    http.js                 fetch + HTML-to-text + link extraction (no cheerio/axios)
    robots.js               robots.txt fetch/parse/allow-check
    rate-limit.js           per-hostname throttle (sourceConfig.requestDelayMs)
    anthropic-client.js     Claude API wrapper + JSON-retry logic
    json-extract.js         tolerant JSON-from-text parser (fences/commentary-proof)
    schema-describe.js      turns a zod core_facts schema into a prompt-ready field list
    prompts.js              discover/refresh/summary prompt templates (vertical-agnostic)
    constants.js            PENDING_SUMMARY_MARKER, DRAFT_RELIABILITY_SCORE
/.github/workflows
  deploy.yml              <- Step 7: build + deploy to GitHub Pages
  weekly-refresh.yml      <- Step 8: cron -> discover -> refresh -> summaries -> validate -> commit
```

## Config design

`site.config.json` at the repo root is the single source of truth for a
vertical instance. See `/config-examples` for four other fully-worked
examples (hotels, local services, courses, event planning) proving the same
schema covers all five target verticals:

| Vertical | entityLabel | categoryLabel | regionLabel | schemaTypePrimary |
|---|---|---|---|---|
| Running races (live) | race | Distance Type | Country/City | SportsEvent |
| Hotel / loyalty guides | hotel | Loyalty Program | City | Hotel |
| Local services | provider | Service Type | City/District | LocalBusiness |
| Online courses / bootcamps | course | Career Outcome | Country or Online | Course |
| Event planning vendors | vendor | Vendor Type | City | Service |

Core fields: `siteName`, `siteTagline`, `siteDomain`, `verticalKey`,
`entityLabelSingular`, `entityLabelPlural`, `categoryLabel`, `regionLabel`,
`regionGranularity`, `schemaTypePrimary`, `monetizationModel`,
`primaryCTAType`, `theme` (primaryColor + light/dark tokens),
`enabledFeatures`, `aiPromptProfile`, `sourceConfig`, `regionsSupported`,
`categoriesSupported`.

## Universal schema (Step 2)

`src/lib/schema/base.js` defines the universal entity/category/region/listicle
shapes with zod -- every field listed in the spec (`entity_id`, `slug`,
`name`, `category_id`, `region_id`, `short_description`, `ai_summary`,
`core_facts`, `pros`, `cons`, `sentiment_scores`, `excerpt_quotes`, `faqs`,
`reliability_score`, `tags`, `source_mix`, `affiliate_links`, `cta_links`,
`related_entity_ids`, `last_updated`, `status`). `core_facts` is validated
separately per vertical: `src/lib/schema/core-facts/{races,hotels,
local-services,courses,event-planning}.js` each export a small zod schema,
and `core-facts/index.js` is the one registry mapping `verticalKey` ->
schema. `getEntitySchema(verticalKey)` (in `src/lib/schema/index.js`) merges
the two. Adding a 6th vertical never touches `base.js` or any route/component
-- just one new core-facts file + one registry line.

`scripts/validate-data.js` is now a real implementation: it loads every file
under `/data`, validates it against the schema above, flags duplicate
ids/slugs, cross-references `category_id`/`region_id`/`related_entity_ids`/
`manual_entity_ids` so orphan pages and broken internal links are caught
before a build, and warns (without failing) on FAQ answers outside the
40-60 word atomic-answer target. It exits non-zero on any real error.

**Testing note:** `npm install` can't run in the sandbox this was built in
(network-restricted), so `validate-data.js` (which imports `zod`) hasn't
been executed end-to-end yet -- only smoke-tested with a dependency-free
hand-rolled equivalent. Run `npm install && npm run validate` once on your
machine to confirm it passes for real before relying on it in CI.

One real seed example is in `/data` now (not the full races vertical --
that's Step 5): the **Nong Khai Running Festival** entity, sourced from
`ASEAN Race Monitor.xlsx`, plus its `full-marathon`/`half-marathon`
categories, `thailand`/`nong-khai-thailand` regions (demonstrating the
hierarchical `parent_region_id` support), and a `best-full-marathons-thailand`
listicle (demonstrating filter-driven generation, including matching a
country-level filter against a city-level region via
`buildRegionAncestryMap` in `src/lib/data.js`).

## Core layouts and components (Step 3)

`tailwind.config.mjs` reads `site.config.json.theme` directly (it's just a
Node module, same trick as `astro.config.mjs`) and exposes it as
`bg-brand-*` / `text-brand-*` / `border-brand-*` Tailwind colors, light
values by default and `-dark` variants applied via Tailwind's `dark:`
prefix (`darkMode: 'class'`). Changing a site's whole palette is a
`site.config.json` edit -- no component ever hardcodes a color.

`src/lib/urls.js` centralizes every route path (`urls.entity(slug)`,
`urls.category(slug)`, etc). The entity segment uses `entityLabelPlural`
from config (e.g. `/races/...`, `/hotels/...`); `categories`/`regions`/
`best` stay generic since they're structural site sections, not vertical
words. **Step 4's routes must produce URLs matching this file exactly.**

`src/layouts/BaseLayout.astro` is the one shell every page renders through:
head/meta/OG tags, canonical link, a `jsonLd` prop that serializes whatever
schema objects Step 6 hands it, a no-flash dark-mode init script, skip link,
Header, Footer. Nothing vertical-specific lives here.

Shared components in `src/components/`: `Header`, `Footer`, `ThemeToggle`
(dark/light, localStorage-persisted), `Breadcrumb`, `FactsTable` (generic
`core_facts` renderer, auto-titleizes keys), `ProsCons`, `SentimentBreakdown`,
`ExcerptQuotes`, `FAQSection` (native `<details>`, zero-JS crawlable),
`CTABlock` (respects `enabledFeatures.affiliateLinks`), `EntityCard`,
`HubCard` (generic category/region/listicle card), `RelatedEntities`,
`RelatedListicles`, `StatsSummary`, `FilterBar` (client-side tag filter over
already-rendered, still-crawlable cards; persists last choice when
`enabledFeatures.savedFilters` is on), `Pill`, `ReliabilityBadge`,
`LastUpdated`. None of these import or reference a vertical-specific word.

Several components carry comments flagging exactly where Step 6 hooks in
(BreadcrumbList / FAQPage JSON-LD builders that consume the same data these
components already render), so schema markup doesn't require touching the
components themselves.

**Testing note:** same caveat as Step 2 -- `npm install` can't run in this
sandbox, so `astro build`/`astro dev` haven't actually rendered these
components yet. Every `.astro` file's frontmatter (the JS between the `---`
fences) was extracted and syntax-checked with `node --check`, and all pass,
but that doesn't validate the Astro template markup itself. Run `npm
install && npm run dev` on your machine after Step 4 adds real pages to
visually confirm.

## Dynamic routes (Step 4)

All 7 page templates from the spec now exist as real Astro routes, reading
entirely from `/data` via `src/lib/data.js` and `src/lib/listicles.js` --
none of them hardcode any content, only structure:

- **Home** (`src/pages/index.astro`): stats summary, top-level regions,
  categories, highest-reliability entities, Best Of guides, generic
  methodology-flavored FAQs.
- **Region hub** (`src/pages/regions/[slug].astro` + `regions/index.astro`):
  unique intro, stats, child-region drill-down, category filter chips,
  entity grid, FAQs. Country-level hubs roll up city-level entities
  automatically via `buildRegionAncestryMap` (Nong Khai's race shows up
  under both `/regions/nong-khai-thailand/` and `/regions/thailand/`).
- **Category hub** (`src/pages/categories/[slug].astro` + index): same
  shape, region filter chips, related-category cross-links.
- **Entity profile** (`src/pages/[entityType]/[slug].astro`): every element
  from the spec's entity-page requirements -- H1, one-line intro, AI
  summary, facts table, pros/cons, sentiment, quotes, tags, CTA, FAQs,
  related entities, related listicles, last-updated, breadcrumb, links to
  its category and region hubs. `[entityType]` is a *route parameter*, not a
  literal folder name -- `getStaticPaths` only ever sets it to
  `site.config.json.entityLabelPlural`, so this file produces
  `/races/slug/`-style URLs without containing the word "race" anywhere.
- **Listicle** (`src/pages/best/[slug].astro` + index): resolves
  `filters` + `manual_entity_ids` into a ranked, numbered list via
  `resolveListicleEntities` (src/lib/listicles.js) -- ranking, region rollup,
  and editorial pins all handled generically.
- **About & Methodology** (`src/pages/about.astro`): verification process,
  what the reliability score means, AI-generation policy, conditionally
  shows a monetization disclosure only when `monetizationModel !== 'none'`.
- **Privacy / Terms / Contact** (`src/pages/{privacy,terms,contact}.astro`):
  real starting-point copy (not lorem ipsum), each flagged as a template
  that needs a legal review pass before relying on it, using
  `site.config.json.contactEmail` (new field, added this step).

**Testing note:** `src/lib/data.js`, `listicles.js`, `urls.js`, and
`config.js` have zero Astro/zod dependency, so I actually executed them in
plain Node against the real seed data from Step 2 -- URL generation, the
Thailand-rolls-up-Nong-Khai region hierarchy, category filtering, and
listicle resolution all produced correct output. The `.astro` template
markup itself (and Tailwind's actual CSS output) still needs a real
`npm install && npm run dev` on your machine to see rendered -- that part
of the toolchain can't run in this sandbox.

## Visual fidelity to runsea.run (mid-Step 5 revision)

Before seeding real race data, the races instance's design tokens were
replaced with the *exact* values from runsea.run's live design system
(extracted from `Races/design.html`, a self-contained reference file the
site's own README describes as "carrying the complete Run SEA design
system, extracted verbatim from the live site"). This was a direct
response to user feedback wanting the visual identity preserved exactly,
not just "in the same spirit."

Changed: `site.config.json.theme` now carries the full real palette (lime
`#c8ff33` primary, graphite `#15170f` / paper `#f5f5f2` light mode, `#12130f`
dark mode, plus success/warning/error and highlight tokens), real fonts
(Archivo display + General Sans body, loaded from Google Fonts + Fontshare
to match exactly), and real radius tokens. `tailwind.config.mjs` reads all
of it with `pick()` fallbacks so a future vertical instance with a leaner
theme object still builds cleanly. Components were revised to match the
reference's restrained use of the lime accent (backgrounds/active-states/
focus-rings/logo only, never as plain link/text color, since lime-on-paper
text reads poorly) via two new utility classes in `global.css`:
`.link-accent` (bold text + lime underline) and `.link-muted` (muted nav
links, full-color + underline on hover). `EntityCard`/`HubCard` now use the
reference's exact radius/shadow/hover-lift; `FilterBar` now matches the
reference's segmented "chip-toggle" look; `CTABlock`'s primary button uses
ink-on-lime text (not white) matching the reference's contrast handling;
`ReliabilityBadge`/`ProsCons` use the real success/warning/error tokens
instead of generic Tailwind colors. Added `Logo.astro` (the exact inline
brand-mark SVG), `HeroStats.astro` and `SearchBox.astro` (matching the
reference hero's stat row and search box), and `src/lib/text.js`'s
`splitAccentWord()` so the home page's headline can render one
config-marked word (`site.config.json.heroHeadline`, using `*asterisks*`)
with the reference's outlined-text treatment.

**One deliberate, flagged difference:** the live runsea.run shows race
details in a client-side modal over the single directory page. This engine
instead renders each entity as its own real, crawlable static page (per
this whole project's SEO requirements -- schema markup, unique URLs,
FAQPage/BreadcrumbList, no orphan pages). The user asked for the *visual*
identity to stay exact, which this preserves; the modal-vs-page difference
is architectural, not visual, and was called out rather than silently
decided.

## First working vertical: races (Step 5)

`/data` now holds **8 real race entities**, sourced directly from
`Races/ASEAN Race Monitor.xlsx` (the same hand-verified dataset behind the
live runsea.run) -- every date, distance, organizer, price, and source URL
comes from that workbook's `Events` sheet. Nothing was invented; where the
workbook had no value (e.g. an unpublished registration deadline), the
listing says so rather than guessing. Selected for a deliberate spread:

- **4 Full Marathon-primary**: Nong Khai Running Festival (Thailand),
  Dili International Marathon (Timor-Leste), VnExpress Marathon Nha Trang
  (Vietnam, reliability 93 -- highest in the set), Bank Jateng Borobudur
  Marathon (Indonesia, routed through the Borobudur UNESCO site).
- **4 Half Marathon-primary**: IJM Allianz Duo Highway Challenge (Malaysia,
  closed-highway course), Great Eastern Women's Run (Singapore, women-only
  + family distances), The Brunei Half Marathon (Bandar Seri Begawan),
  Luang Prabang Half Marathon (Laos, charity race for a children's
  hospital).

Supporting data: **9 regions** (8 countries + Nong Khai as a child region of
Thailand, exercising the country-rolls-up-city hierarchy from Step 2 against
real data), **2 categories** (Full Marathon, Half Marathon), and **3
listicles** -- the Thailand-only one from Step 2, plus new region-spanning
`best-full-marathons-southeast-asia` and `best-half-marathons-southeast-asia`
guides (category filter only, no region_id, proving the filter engine works
both scoped and unscoped). `related_entity_ids` cross-link entities within
the same category across different countries, exercising the "Related
races" section with real data instead of an empty state.

**Deliberately not migrated here:** the workbook's other ~227 rows. The
spec asks for "at least 5" hand-seeded entities for this step; bulk-migrating
the full historical dataset by hand would just be simulating what
`discover-entities.js` / `refresh-entities.js` / `generate-summaries.js`
(Steps 8-9) are supposed to do for real, via the Claude API, on an ongoing
basis. Doing that by hand now would produce content that never demonstrates
whether the actual pipeline works.

**Validated, not yet build-tested:** every JSON file was checked for schema
shape (all required fields, valid slugs, FAQ word counts now all in the
40-60 range) and referential integrity (every `category_id`/`region_id`/
`related_entity_ids`/`parent_region_id`/listicle filter resolves to a real
file, zero orphans) using a dependency-free Node script mirroring
`validate-data.js`'s logic. The real `data.js`/`listicles.js` pipeline
(zero Astro/zod dependency) was also executed directly against this full
dataset: category grouping, region rollup (Thailand correctly includes
Nong Khai), and all 3 listicles' ranked resolution all produced correct
output. Rendering the actual pages still needs `npm install && npm run dev`
on your machine.

## Full data migration: all 227 races (post-Step 10, "redo the backend" request)

Once every engine step above was built and reviewed, the user asked for the
new engine to actually replace the existing (separate, Python-generated)
runsea.run site -- not just demonstrate the pattern on 8 sample entities.
`scripts/lib`/`data.js`/etc. never needed to change for this; only `/data`
grew.

**Migration script** (one-off, not committed to the repo -- lives in the
session's scratch space): reads every row of `ASEAN Race Monitor.xlsx`
directly, reuses the already-computed, already-deduplicated slugs from the
live site's own generated `Run SEA - Race Directory.html` DATA blob (so
entity slugs match the URLs already indexed by search engines, rather than
inventing a second slug scheme), classifies each race into a category by
its distance summary (full/half marathon takes priority as the "marquee"
category per `base.js`'s own documented convention; otherwise falls back to
ultra/10k/5k by largest distance found), and builds every field mechanically
from verified spreadsheet columns only -- `ai_summary`/`short_description`
are template sentences grounded in those same verified fields (no
LLM call), never inventing anything the sheet doesn't say.

**pros/cons/excerpt_quotes/faqs/sentiment_scores are deliberately left
empty** on all newly migrated entities (all schema-valid: base.js defaults
these to `[]`/optional). That editorial layer is exactly what
`generate-summaries.js` (Step 9) is for -- it's left to run for real, via
GitHub Actions with a real `ANTHROPIC_API_KEY`, rather than being faked here
with more template text. **`generate-summaries.js`'s targeting condition
was broadened** (it previously only matched entities carrying the exact
`PENDING_SUMMARY_MARKER` placeholder) to also match any entity with empty
`pros`/`cons`/`faqs` regardless of its `ai_summary` value -- otherwise these
227 migrated entities, which already have a real (template) summary, would
never have been picked up for pros/cons/FAQ enrichment.

**Status: all migrated entities are `"active"`, not `"draft"`.** This is a
migration of already-verified, already-live spreadsheet data (the same data
already serving real production traffic on the old site), not
newly-discovered unverified candidates -- it doesn't belong in the
draft/review queue the way `discover-entities.js`'s output does.

**Duplicate collision, found and fixed:** the original 8 hand-crafted
entities from Step 5 used slugs without a year suffix (e.g.
`nong-khai-running-festival`); the live site's actual slug convention
includes the year (`nong-khai-running-festival-2026`). The migration's
"don't overwrite already hand-crafted entities" guard checked for an
existing file at the *new* slug, so it missed this and initially created 8
duplicate entities for the same real-world races. Caught immediately by
comparing entity names, not just slugs, across old and new files. Fixed by
moving each of the 8 rich (rich pros/cons/sentiment/FAQ) entities onto the
correct year-suffixed slug, and neutralizing the old no-year-suffix files by
setting `status: "archived"` (excluded from every listing/sitemap/page,
same mechanism used for any retired entity) rather than deleting them --
this environment's file-deletion limitation applies to newly-created
`seo-engine` files too, so archiving in place was the only option. Cross-
references in `related_entity_ids` between those 8 entities were remapped
to the new slugs too, so "Related races" never silently points at an
archived, invisible entity.

**Also added:** 3 missing category files (`5k`, `10k`, `ultra-marathon` --
`site.config.json.categoriesSupported` already listed these 5 distances, but
only `full-marathon`/`half-marathon` existed as seed data before this) and
3 missing region files (`philippines`, `cambodia`, `myanmar` --
`regionsSupported` listed all 11 countries, but only 8 had region files).

**Verified:** a from-scratch Python structural check (mirroring every
`baseEntitySchema`/`racesCoreFactsSchema` constraint: slug pattern, required
fields, short_description length, URL validity in `source_mix`/`cta_links`,
reliability_score bounds, zero orphan `category_id`/`region_id`/
`related_entity_ids`/`parent_region_id`) against all 235 entity files (227
active + 8 archived) found zero errors, zero warnings. The real
`data.js`/`listicles.js` pipeline was executed directly against the full
dataset: all 5 categories and 12 regions load correctly, all 3 listicles
resolve real ranked top-10 lists from the full 227 (previously only ever
tested against 8), and Nong Khai's region ancestry chain still correctly
rolls up to Thailand. `sitemap.xml.js` was executed directly and produced
exactly 255 URLs (8 static + 5 categories + 12 regions + 227 active entities
+ 3 listicles -- archived entities correctly excluded). `schema-jsonld.js`'s
`buildEntitySchema` was spot-checked against a freshly migrated entity
(Bromo Marathon) and produced a correct, minimal `SportsEvent` schema
(omitting `offers`/`organizer` since that entity's core_facts don't have
them -- the "don't invent a property" rule holding on migrated data too,
not just the original 8 hand-crafted entities).

**Not yet done:** a real `npm install`/`astro build` still hasn't happened
anywhere (same standing limitation as every step before this). The repo
also hasn't been pushed to GitHub yet under this state -- that's the very
next thing, so GitHub Actions can build it for real and this can be viewed
on a live (but non-production) URL before runsea.run's domain is ever
pointed at it.

## Schema markup, robots.txt, sitemap (Step 6)

`src/lib/schema-jsonld.js` -- pure builder functions, no vertical-specific
code: `buildEntitySchema` (typed from `site.config.json.schemaTypePrimary`,
maps `core_facts.date/venue/city/country/organizer/price_range` to
`startDate`/`location`/`organizer`/`offers` only when those facts actually
exist -- deliberately does NOT map `reliability_score` to schema.org's
`aggregateRating`, since that property means reviewer ratings and
reliability_score is a source-verification score; using it there would be
misleading structured data), `buildFaqPageSchema`, `buildBreadcrumbListSchema`,
`buildItemListSchema` (generic over entities/categories/regions/listicles
via `toUrl`/`toName` callbacks), and `buildWebsiteSchema`. Every page (entity,
category hub, region hub, listicle, home, about, privacy, terms, contact,
and both `categories`/`regions`/`best` index pages) now passes real `jsonLd`
into `BaseLayout`, built from data already on the page -- nothing is ever
defined twice for display vs. schema. FAQPage/ItemList emission is gated by
`enabledFeatures.faqSchema`/`itemListSchema` per vertical instance.

`public/robots.txt` (the static Step-1 placeholder) is superseded by
`src/pages/robots.txt.js`, a build-time endpoint that reads the sitemap URL
from Astro's `site` (itself from `site.config.json.siteDomain`) and
explicitly allows GPTBot, ChatGPT-User, ClaudeBot, anthropic-ai,
PerplexityBot, Google-Extended, CCBot, Googlebot, and Bingbot -- no domain
is ever hardcoded. `src/pages/sitemap.xml.js` enumerates every real route
(static pages + every active entity/category/region/listicle) using the
same `urls.js` helpers every component uses, so it can't drift from actual
routes.

The old static `public/robots.txt` placeholder (couldn't be deleted from
the build environment this repo was originally scaffolded in) has since
been removed -- `src/pages/robots.txt.js` is the only source now.

**Verified:** `robots.txt.js` and `sitemap.xml.js` export plain `GET`
functions with no Astro-specific runtime dependency, so both were executed
directly in Node against the real Step 5 dataset -- robots.txt lists all 9
allowed agents plus the correct sitemap URL, and sitemap.xml produced
exactly 30 `<url>` entries (8 static pages + 2 categories + 9 regions + 8
entities + 3 listicles, matching the real counts). All five
`schema-jsonld.js` builders were also run against real entity/breadcrumb/
listicle data and produced valid-looking schema.org JSON-LD (spot-checked:
Nong Khai's `SportsEvent` schema correctly included `startDate`/`location`
and correctly omitted `offers`/`organizer`, since that entity's core_facts
don't have `price_range`/`organizer` values -- confirming the "only add a
property when the fact exists" rule actually holds, not just in theory).

## GitHub Pages deploy workflow (Step 7)

`.github/workflows/deploy.yml` -- builds and publishes on every push to
`main`, plus supports a manual re-run from the Actions tab
(`workflow_dispatch`, no new commit required -- useful right after adding/
changing a repo secret, or after Step 8's weekly-refresh workflow commits
new data and you want to redeploy immediately rather than wait).

Two jobs: `build` checks out the repo, installs Node 20 (with `cache: npm`,
keyed off the committed `package-lock.json`), runs `npm ci`, runs `npm run
build`, and uploads `dist/` as a Pages artifact. `deploy` (depends on
`build`) publishes that artifact via `actions/deploy-pages@v4`.
`concurrency: { group: pages, cancel-in-progress: true }` means if two
pushes land close together, the newer one wins rather than both queuing.

**One-time manual step required (not doable from here):** in the GitHub
repo's Settings -> Pages, set "Source" to "GitHub Actions" (not "Deploy
from a branch"). Without this, the workflow's `deploy` job will fail even
though `build` succeeds, since the Pages environment won't exist yet. This
has to be done once, by hand, in the GitHub UI after the repo exists.

**Verified:** the workflow YAML parses cleanly (checked with a plain YAML
parser -- both jobs and the push/workflow_dispatch triggers are present and
correctly structured). Actual execution can't be verified until the repo is
pushed to GitHub and Actions runs it for real, since this sandbox has no
route to `github.com` or the npm registry (see "Known decisions" below).

## Weekly refresh workflow (Step 8)

`.github/workflows/weekly-refresh.yml` -- runs every Monday 03:00 UTC
(matching `site.config.json`'s `sourceConfig.refreshIntervalDays: 7`), plus
supports a manual `workflow_dispatch` run from the Actions tab. Pipeline:
`npm run validate` (pre-flight -- refuses to layer new changes on top of
already-broken data) -> `npm run discover` -> `npm run refresh` -> `npm run
summaries` -> `npm run validate` (post-run -- fails the whole job, no PR, if
the AI pipeline produced anything schema-invalid or cross-reference-broken)
-> diff check on `data/` -> if changed, opens a pull request via
`peter-evans/create-pull-request`; if not, logs and exits clean.

**Deliberately never pushes straight to `main`.** This is the "safety
valve" flagged as an open decision back in Step 6/7's notes. Passing schema
validation proves a file is *structurally* valid, not that an AI-discovered
race or AI-written summary is *factually* correct -- a source site could
change its markup, a script could misread a date, a summary could
subtly misstate something. So every run's output lands in a PR with a body
that explicitly tells the reviewer "validation passing isn't the same as
this being true, go read the diff," and only a human merge (a real push to
`main`) triggers `deploy.yml` and goes live.

**Needs one secret, added manually in GitHub (same pattern as Step 7's
Pages-source setting):** Settings -> Secrets and variables -> Actions ->
New repository secret -> `ANTHROPIC_API_KEY`. Without it, `discover`/
`refresh`/`summaries` will run once Step 9 implements them for real, but
every Claude API call inside them will fail.

**What this runs today, right now:** `discover-entities.js`,
`refresh-entities.js`, and `generate-summaries.js` are still Step-1 stubs
that log a message and `exit(0)` -- see Step 9 below. So on the current
codebase this workflow will execute successfully on schedule, do nothing to
`data/`, and skip the PR step every time. That's expected and safe; it
becomes the real pipeline once Step 9 lands.

**Verified:** YAML parses cleanly (both jobs/steps present, `contents:
write` + `pull-requests: write` permissions set). Confirmed all three
pipeline scripts currently `console.log(...); process.exit(0)` (so the
workflow won't fail on today's codebase) and that `validate-data.js` exits
non-zero on real errors (so the pre-flight/post-run gates are real, not
decorative) by reading the scripts directly. Real end-to-end execution
(actually opening a PR) can't be verified until Step 9 gives the pipeline
something to change, and the repo exists on GitHub for Actions to run
against.

## AI prompt templates and JSON validation (Step 9)

Real implementations of the three pipeline scripts, all built on a shared
`scripts/lib/` (see repo layout above). None of these three scripts, or
anything in `scripts/lib/`, contains a hardcoded vertical word -- every
piece of vertical vocabulary comes from `siteConfig` (entityLabelSingular/
Plural, schemaTypePrimary) or is introspected at runtime from that
vertical's own `core_facts` zod schema via `schema-describe.js`. The same
three scripts run unmodified for a hotels/courses/local-services/
event-planning instance; only `site.config.json` and
`src/lib/schema/core-facts/<vertical>.js` change.

**`discover-entities.js`** -- for each domain in
`sourceConfig.trustedAggregators`: checks robots.txt
(`scripts/lib/robots.js`), throttles per-hostname
(`sourceConfig.requestDelayMs`), fetches the page, strips it to plain text
(`scripts/lib/http.js` -- a deliberately simple regex-based HTML-to-text,
not a real parser, to avoid adding a cheerio/jsdom dependency), and sends it
to Claude with a discovery prompt. The trickiest vertical-agnostic problem
here: assigning `category_id`/`region_id` to a new candidate would
normally require vertical-specific logic (e.g. "map distance_km to Full
Marathon vs Half Marathon" -- exactly the kind of hardcoding this engine is
built to avoid). Solved by asking Claude itself to match against THIS
vertical's own `data/categories`/`data/regions` labels (loaded at runtime
and passed into the prompt) rather than teaching the script what a
"category" means. A candidate is only ever written to disk if: its slug is
genuinely new, its matched category/region label resolves to a real
existing file, its `core_facts` passes that vertical's zod schema, and the
fully-assembled entity passes the universal schema too -- any failure at
any of those checks skips the candidate with a logged reason instead of
writing something bad. New entities are written `status: "draft"` with
`ai_summary` set to a placeholder marker (`PENDING_SUMMARY_MARKER`) --
discovery's job is finding verifiable facts, not writing copy.

**`refresh-entities.js`** -- re-fetches one source per existing
`active`/`needs_review` entity (preferring `official` >
`registration_platform` > others from `source_mix`), and asks Claude to
report ONLY fields the fresh page explicitly contradicts (absence of a fact
is never treated as evidence it changed). Deliberately conservative status
handling: this script can flag an entity `needs_review`, but it never
promotes anything to `active` and never sets `archived` itself -- both stay
human decisions, matching `enabledFeatures.reviewQueue`. If a source URL is
unreachable, that's treated as a real signal (a dead link isn't neutral):
`reliability_score` drops and the entity is flagged for review rather than
silently left looking as fresh and verified as it was last week.

**`generate-summaries.js`** -- targets every entity whose `ai_summary` is
still exactly `PENDING_SUMMARY_MARKER`, and generates `ai_summary`,
`short_description`, `pros`, `cons`, `faqs`, and (only when actually
supported by `excerpt_quotes`) `sentiment_scores`, grounded strictly in that
entity's own `core_facts`/`tags`/`excerpt_quotes`. Validates FAQ word counts
(target 40-60, matching `validate-data.js`'s own warning bound) and retries
once with a corrective follow-up listing the exact problems found before
giving up and skipping that entity for the run. On success, `status:
"draft"` graduates to `"needs_review"` (real content now exists, but a
human still promotes to `"active"`); any other status is left untouched.

**Shared JSON-safety net (`scripts/lib/anthropic-client.js` +
`json-extract.js`):** `extractJson` tolerates the common ways a model wraps
JSON despite being told not to (markdown fences, a stray sentence of
commentary) by finding the first balanced `{...}`/`[...]` in the response
rather than assuming the whole reply is bare JSON. `callClaudeForJson`
retries once with a corrective follow-up ("your previous response wasn't
valid JSON") if parsing fails, then throws -- callers catch that and skip
the one item rather than crash the whole run. Every script's real content
also passes back through this vertical's full zod schema
(`getEntitySchema(verticalKey)`) before ever touching disk, independent of
whatever the prompt asked for -- a schema-invalid response is refused
regardless of why it went wrong.

**`site.config.json`'s `aiPromptProfile` field is not wired into anything.**
The Step-1 stub comments implied per-vertical prompt template selection by
that field's value; in practice `scripts/lib/prompts.js`'s three builders
turned out fully generic (driven by `siteConfig` + the core_facts schema
introspection described above), so there was never a need for multiple
template variants to select between. `aiPromptProfile` is left in
`site.config.json` as a descriptive label only (documents which prompt
"generation" a vertical instance is on, for humans reading the config) --
if a future vertical genuinely needs different prompt wording/behavior,
that's the field to branch on inside `prompts.js`.

**No new dependencies added.** Uses `@anthropic-ai/sdk` and `zod` (already
in `package.json` since Step 1/2) plus Node 18+'s built-in `fetch` -- no
cheerio, no axios, no robots-parser package.

**Verified:** every file under `scripts/` and `scripts/lib/` passes `node
--check`. Everything with no Claude-SDK/zod dependency was executed for
real against hand-built inputs: `json-extract.js`'s `extractJson` against
five cases (plain JSON, fenced-with-commentary, unfenced-with-commentary,
invalid text, unbalanced JSON) -- all five behaved correctly, including
correctly ignoring `{`/`}`/`[`/`]` characters that appear inside a JSON
string value rather than miscounting bracket depth. `http.js`'s
`htmlToText`/`extractLinks` against a hand-built HTML snippet (script/style
stripped, entities decoded, relative links resolved). `robots.js`'s
`isAllowed` against a hand-written robots.txt covering a named-agent
disallow-all group, a wildcard group with an Allow-overriding-a-Disallow
case, and the "robots.txt unreachable -> allow" fallback -- all matched
expected results, including one real bug caught and fixed in the process
(a wrong variable was being passed into the agent-matching function).
`rate-limit.js`'s `throttle` timed for real (two calls 300ms apart took
301ms, confirming it actually waits rather than just tracking a timestamp).
`schema-describe.js`'s `describeSchemaShape` against a hand-built fake zod
schema mimicking the races `core_facts` shape (required/optional/array/enum
fields) -- produced the exact expected field-by-field description.
`prompts.js`'s three builders executed with real races-shaped inputs and
inspected for correct, config-driven wording.

What could **not** be verified in this environment: the three top-level
scripts (`discover-entities.js`, `refresh-entities.js`,
`generate-summaries.js`) import `zod` and `@anthropic-ai/sdk`, neither of
which can be installed here (no route to the npm registry -- see "Known
decisions" below), and their logic depends on live network fetches and real
Claude API responses. They're syntax-checked and were carefully re-read
end-to-end for consistency with the verified helpers above, but genuine
end-to-end execution (a real discover -> refresh -> summaries run against
live sources) can only happen once this repo exists on GitHub and Actions
runs `weekly-refresh.yml` for real, or once you run `npm install && node
scripts/discover-entities.js` locally with `ANTHROPIC_API_KEY` set.

## Cleanup and hardcoded-vertical-word audit (Step 10)

Ran a repo-wide grep audit across `src/`, `scripts/`, `astro.config.mjs`,
`tailwind.config.mjs`, and `package.json` (deliberately excluding
`data/`, `config-examples/`, and `site.config.json` -- those are SUPPOSED
to contain vertical words, that's the seed data / reference-config /
instance-config layer) for every vertical's vocabulary: race/races/
racing/marathon/distance_km/elevation, hotel/hotels/loyalty, bootcamp/
vendor/vendors/provider/providers, course/courses, event-planning/
local-service.

Every match found was one of exactly two legitimate things, never a real
hardcoding bug:

1. **Explanatory comments** using a vertical word as a worked example
   (e.g. `src/lib/urls.js`'s comment "so entity URLs read naturally per
   vertical -- runsea.run/races/nong-khai-running-festival/"). These
   document the pattern for future readers; they don't affect runtime
   behavior.
2. **The core-facts registry itself** (`src/lib/schema/core-facts/index.js`
   and its five per-vertical files) -- this is the intentional, designed
   extension point (exactly like `site.config.json`), not an example of
   the shared engine leaking vertical logic. `getCoreFactsSchema(verticalKey)`
   is how a vertical's shape gets pulled in generically.

Also specifically checked for the two riskiest anti-patterns and found
neither: no `if (verticalKey === '...')` conditional branching anywhere in
`src/` or `scripts/`, and no hardcoded UI copy (category/region labels,
button text, etc.) standing in for a `siteConfig.*Label*` value. Also
confirmed `config-examples/` is genuinely inert -- grepped for any import of
it from build code and found none; it exists only for a human to read.

**Cleanup:** found one leftover dev-only artifact, `preview-home.html`
(repo root) -- a hand-built static HTML preview created earlier in this
build to sanity-check the visual design before a real `npm install` was
possible in this environment. It was never part of the Astro build
(nothing referenced it) and has since been deleted.

No code changes were needed as a result of this audit -- the engine was
already clean. That's the payoff of having threaded `siteConfig` and the
core-facts schema registry through every step from Step 1 onward, rather
than writing races-specific code first and generalizing it at the end.

## Known decisions / open items carried into later steps

- **One repo per live site.** GitHub Pages serves one custom domain per repo,
  so this engine is a template instantiated per site, not a monorepo
  deploying five domains at once.
- **Astro Content Collections + Zod** (not hand-rolled JSON parsing) will
  back the universal schema (Step 2) -- gives free build-time validation.
- **robots.txt and sitemap.xml are build-time-generated** endpoints (Step
  6, `src/pages/robots.txt.js` / `sitemap.xml.js`), reading
  `site.config.json.siteDomain` -- no vertical instance ever hand-edits a
  hardcoded domain. The old static `public/robots.txt` placeholder has
  since been deleted.
- **Weekly-refresh safety valve -- decided in Step 8:** the workflow opens a
  PR with each run's diff rather than pushing straight to `main`. Revisit
  once the AI pipeline (Step 9) has a track record and the PR-per-week
  review overhead feels unnecessary.
- **Legal/ToS diligence is per-vertical**, not generic. Hotel/loyalty data,
  course-platform data, and local-service directory data each carry
  different scraping/ToS sensitivity than race calendars -- the races
  vertical's `sourceConfig` approach must not be assumed to transfer as-is.
- **`runsea.run` is live.** `public/CNAME` points GitHub Pages at it, and
  the races vertical has been deploying to production since Step 7 landed.

## Content safety (applies to every script under /scripts)

- Raw scraped content must never be published directly.
- Only original AI summaries + structured `core_facts` + short attributed
  excerpts (`excerpt_quotes`, each with a source URL) are ever allowed into
  `/data` and onward into the built site.
- Raw scraped material, if a script needs to hold it temporarily, only ever
  lives under `/data/_raw`, which is git-ignored (see `data/_raw/README.md`).
- Every script must respect `robots.txt`, each source's Terms of Service,
  and `sourceConfig.requestDelayMs` rate limits.
