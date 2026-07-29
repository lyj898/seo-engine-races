# Config examples

These four files are reference configs proving the engine's `site.config.json`
schema is genuinely vertical-agnostic. They are **not** read by any build --
Astro only ever reads the real `/site.config.json` at the repo root.

To spin up a new vertical/site instance:

1. Copy the relevant example here to the repo root as `site.config.json`
   (or start a fresh repo from this engine and do the same).
2. Remove the `_exampleOnly` field.
3. Fill in real `siteDomain`, `regionsSupported`, `categoriesSupported`.
4. Add seed data under `/data` matching the universal schema's `core_facts`
   shape documented for that vertical in the root README.
5. Write/adjust the AI prompt template named by `aiPromptProfile` under
   `scripts/prompts/`.
6. Point a new GitHub repo's Pages settings + `public/CNAME` at the new
   domain, add `ANTHROPIC_API_KEY` to that repo's Secrets, done.

| File | Vertical | entity | category | region |
|---|---|---|---|---|
| `hotels.site.config.json` | Hotel review / loyalty guides | hotel | loyalty program | city |
| `local-services.site.config.json` | Local services | provider | service type | city/district |
| `courses.site.config.json` | Online courses / bootcamps | course | topic/career outcome | country or online |
| `event-planning.site.config.json` | Event planning vendors | vendor | vendor type | city |

The active root config (`races`, runsea.run) is the fifth example, live at
`/site.config.json`.
