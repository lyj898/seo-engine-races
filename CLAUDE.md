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
