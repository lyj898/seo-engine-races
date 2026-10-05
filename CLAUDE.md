# Project rules

## New pages/routes

Whenever a new page or route is added anywhere in this repo, both of the
following must be done in the *same* change as the page itself, not deferred:

1. **Mobile responsive check** — verify the layout at 375px, 768px, and
   1024px widths: no horizontal overflow, tap targets are appropriately
   sized, and text/images scale correctly.
2. **Sitemap** — add the new URL to `src/pages/sitemap.xml.js` (it
   build-time-generates `sitemap.xml` from `src/lib/urls.js` — do not
   hand-edit XML or any static sitemap file). If a route list/registry
   like `src/lib/tools.js` already drives both the page and other call
   sites, add the entry there so the sitemap picks it up automatically
   instead of listing the URL a second time by hand.

## Race record template

Every published race record (`status` active or needs_review) in
`data/entities/` must carry all of the following. `npm run validate` warns
on each gap with a `template:` message; fix those before adding more races.

1. **Official link** — `cta_links[0]`, the only outbound link a race page
   shows (`source_mix` is never rendered). In order of preference: the
   organiser's own site ("Visit official site", type `official_website`);
   else the race's own page on its entry platform ("Official race page on
   <Platform>"); else the organiser's Facebook/Instagram page ("Official
   Facebook page", type `official_social`). Never a calendar or aggregator
   (Pinoy Fitness listing, lesgo.my, kalenderlari, AIMS, finishers…), a
   platform index page, or a URL shortener.
2. **Entry link** — `cta_links[1]`, "Entry page on <Platform>" (type
   `registration`), when entries are taken somewhere other than the
   official site.
3. **Facts** — `core_facts.date` as one ISO race day (the day the half or
   full runs), `distance_km` as the organiser lists it (21 km → 21.1, 42 km
   → 42.195), `primary_distance_km`, `city`, `country`, plus `venue`,
   `organizer` and `price_range` whenever the organiser publishes them.
4. **Sources** — at least one `source_mix` entry of type `official`,
   `registration_platform` or (organiser) `social`, each with `last_checked`.
5. **Copy** — `short_description` (≤220 chars, naming the date),
   `ai_summary` of 2–4 factual sentences, and at least two FAQs. Never state
   registration status (open/closed/sold out).

6. **Results, once it has run** — `results: { url, publisher, last_checked }`
   (top level, not in core_facts), pointing at a page you have seen list this
   edition's finishers: the timing company's results page or the organiser's.
   The page then titles itself "<race> <year> Results" and leads with the
   link. `npm run results:due` lists races from the last 21 days still
   missing one. Never on a cancelled or postponed edition.

Check every link loads before deploying. A 403 from a bot wall is fine to
keep only after confirming the page loads in a normal browser.
