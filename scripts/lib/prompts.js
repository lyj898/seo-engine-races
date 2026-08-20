/**
 * Prompt templates for discover/refresh/summaries. Every builder here takes
 * `siteConfig` plus plain data and reads entity/vertical vocabulary from
 * config (entityLabelSingular/Plural, schemaTypePrimary) and from the
 * per-vertical core_facts schema (via schema-describe.js) -- never a
 * hardcoded vertical word. These same three functions run unmodified for
 * races, hotels, courses, local-services, or event-planning; only the
 * config and core-facts schema passed in change.
 *
 * Shared ground rule across all three prompts, stated explicitly in every
 * system prompt: never invent a fact. Omit a field rather than guess it.
 * This is the single most important behavior for a directory site's
 * credibility and for avoiding defamation/misinformation risk -- see the
 * "Content safety" section of README.md.
 */

const NO_INVENTION_RULE =
  'Critical rule: you must never invent, guess, or infer a fact that is not explicitly stated in the ' +
  'provided source material. If information is not present, omit that field entirely rather than estimate ' +
  'or make something plausible up. It is always better to leave a field out than to state something false.';

export function buildDiscoveryPrompt({ siteConfig, coreFactsDescription, availableCategories, availableRegions, sourceUrl, sourceText }) {
  const { entityLabelSingular, entityLabelPlural } = siteConfig;

  // Optional free-form scope restriction a vertical instance can set via
  // site.config.json's sourceConfig.discoveryConstraints (e.g. races
  // restricting discovery to road races, excluding trail/multisport
  // events). Purely a config value the engine passes through -- this file
  // stays vertical-agnostic since it never itself states what a "valid"
  // candidate looks like beyond what config supplies.
  const constraints = siteConfig.sourceConfig?.discoveryConstraints;

  // Rolling date window (sourceConfig.discoveryWindowMonths). Computed from
  // "now" on every run rather than stored as a fixed end date, so the
  // directory keeps reaching the same distance into the future each week
  // instead of gradually running out of upcoming entries. Expressed to the
  // model as explicit ISO bounds -- asking for "the next 12 months" would
  // leave it guessing today's date.
  const windowMonths = siteConfig.sourceConfig?.discoveryWindowMonths;
  let windowRule = '';
  if (Number.isFinite(windowMonths) && windowMonths > 0) {
    const from = new Date();
    const to = new Date(from);
    to.setMonth(to.getMonth() + windowMonths);
    const iso = (d) => d.toISOString().slice(0, 10);
    windowRule =
      ` Date window: only include entries dated between ${iso(from)} and ${iso(to)} inclusive. Skip anything ` +
      `already past, and skip anything scheduled beyond ${iso(to)}. If a listing gives no date at all, skip it.`;
  }

  const system =
    `You are a careful research assistant extracting structured directory listings for a "${entityLabelPlural}" ` +
    `directory website. ${NO_INVENTION_RULE}${constraints ? ` Scope restriction: ${constraints}` : ''}` +
    `${windowRule} Respond with ONLY valid JSON -- no markdown code fences, no commentary before or after it.`;

  const categoryList = availableCategories.map((c) => `"${c.label}"`).join(', ') || '(none configured)';
  const regionList = availableRegions.map((r) => `"${r.label}"`).join(', ') || '(none configured)';

  const prompt = `Source URL: ${sourceUrl}

Source page content (HTML tags stripped):
"""
${sourceText}
"""

Identify every distinct, real ${entityLabelSingular} mentioned in the source content above (there may be zero, ` +
    `one, or many). For each one found, output an object with these fields:

- name (string): the ${entityLabelSingular}'s name, exactly as given in the source.
- short_description (string, one sentence, under 220 characters): a direct, factual summary using only ` +
    `information present in the source.
- category_label (string or null): pick the single closest match from this exact list of allowed labels -- ` +
    `${categoryList} -- based on what the source says about this ${entityLabelSingular}. Use null if none fit.
- region_label (string or null): pick the single closest match from this exact list of allowed labels -- ` +
    `${regionList} -- based on the location stated in the source. Use null if none fit.
- core_facts (object): populate ONLY the fields below that the source explicitly states. Do not include a ` +
    `field if the source doesn't say it.
${coreFactsDescription}
- tags (array of short strings): a few relevant descriptive tags actually supported by the source content.
- source_url (string): the specific detail-page URL for this ${entityLabelSingular} if one is given in the ` +
    `source, otherwise repeat the given Source URL.
- confidence ("high" | "medium" | "low"): your confidence that this is a real, currently-relevant ` +
    `${entityLabelSingular} and that the extracted facts are accurate.

Respond with a JSON array of these objects (an empty array [] if none are found). Output ONLY the JSON array.`;

  return { system, prompt };
}

export function buildRefreshPrompt({ siteConfig, entity, coreFactsDescription, sourceUrl, sourceText }) {
  const { entityLabelSingular } = siteConfig;

  const system =
    `You are a careful fact-checking assistant re-verifying an existing "${entityLabelSingular}" directory ` +
    `listing against a freshly fetched source page. ${NO_INVENTION_RULE} Absence of a fact in the new source ` +
    'text is NOT evidence that the fact has changed -- only report a field as changed if the new source text ' +
    'explicitly states something different from the current value. Respond with ONLY valid JSON -- no markdown ' +
    'code fences, no commentary.';

  const prompt = `Existing ${entityLabelSingular} record:
Name: ${entity.name}
Current core_facts: ${JSON.stringify(entity.core_facts)}

Freshly fetched source (${sourceUrl}), HTML tags stripped:
"""
${sourceText}
"""

The core_facts field shape for this vertical is:
${coreFactsDescription}

Compare the current core_facts above against what this fresh source page actually states. Output a JSON object:

- changed_fields (object): ONLY the core_facts fields that the fresh source explicitly contradicts or updates ` +
    `versus the current value. Omit any field that is unmentioned, unchanged, or merely consistent with the ` +
    `current value. Use {} if nothing has changed.
- status_recommendation ("active" | "needs_review" | "archived"): "archived" only if the source explicitly ` +
    `indicates this ${entityLabelSingular} is cancelled, permanently discontinued, or no longer exists. ` +
    `"needs_review" if something looks off or the source contradicts the record in a way you're not fully ` +
    `confident about. Otherwise "active".
- reasoning (string, under 280 characters): a brief factual justification for the above.
- confidence ("high" | "medium" | "low").

Output ONLY the JSON object.`;

  return { system, prompt };
}

/**
 * Asks the model to go and read what the wider web says about one entity
 * and bring back quotable first-hand material plus a sentiment read.
 *
 * Deliberately NOT a facts prompt: dates, distances and venues already come
 * from the aggregator pipeline and are re-verified weekly. What's missing is
 * everything a person would actually want to know before signing up, which
 * only exists in race reports, forum threads and reviews. The output feeds
 * excerpt_quotes/sentiment_scores, which buildSummaryPrompt then writes
 * from -- so improving this prompt improves every listing's prose.
 *
 * Quotes must carry a real source_url. That's the guard against the model
 * paraphrasing its own priors into something that looks like a review: an
 * unattributable quote is dropped by the caller.
 */
/**
 * Writes the editorial wrapper around a generated guide: title, intro, FAQs.
 *
 * The list itself is resolved from filters at build time, so this prompt is
 * only ever asked for the framing -- and the framing is the entire reason
 * the page deserves to exist rather than being a duplicate of the hub page
 * it overlaps with. It's given the real matched entries so the intro can
 * say something specific about this actual set rather than producing the
 * interchangeable filler that makes generated guides obvious.
 */
export function buildListicleCopyPrompt({ siteConfig, category, region, matched }) {
  const { entityLabelSingular, entityLabelPlural, siteName } = siteConfig;
  const where = region ? region.label : 'Southeast Asia';

  const system =
    `You are an editor writing a guide for ${siteName}, a directory of ${entityLabelPlural}. ` +
    `${NO_INVENTION_RULE} Write for someone choosing between these options who has never seen them before.\n\n` +
    'Style rules:\n' +
    '- Never describe how the list was assembled, ranked, verified, filtered or generated. No mention of ' +
    'scores, sources, automation or update schedules. The reader came for the subject, not the machinery.\n' +
    '- Never open with the guide\'s own title restated as a sentence, and never open with "Whether you\'re...". ' +
    'Open on something concrete from the entries themselves.\n' +
    '- Be specific where a generic guide would be vague: name actual places, months, and the things that ' +
    'genuinely differ between these entries. A sentence that would read identically for a different country ' +
    'or distance is a wasted sentence.\n' +
    '- Do not claim the list is complete, definitive or objectively "best".\n' +
    'Respond with ONLY valid JSON -- no markdown code fences, no commentary.';

  // Give the model the real spread it's describing. Without the month
  // distribution it writes "races run throughout the year" for every guide;
  // with it, it can say something true and specific about this one.
  const months = {};
  matched.forEach((e) => {
    const d = e.core_facts?.date;
    if (typeof d === 'string') months[d.slice(0, 7)] = (months[d.slice(0, 7)] || 0) + 1;
  });
  const monthSpread = Object.entries(months).sort().map(([m, n]) => `${m}: ${n}`).join(', ') || '(no dates)';

  const cities = [...new Set(matched.map((e) => e.core_facts?.city).filter(Boolean))];

  const sample = matched.slice(0, 14).map((e) => {
    const f = e.core_facts ?? {};
    const loc = [f.city, f.country].filter(Boolean).join(', ');
    const dist = Array.isArray(f.distance_km) ? [...f.distance_km].sort((a, b) => b - a).join('/') + 'km' : '';
    return `- ${e.name}${loc ? ` — ${loc}` : ''}${f.date ? `, ${f.date}` : ''}${dist ? `, ${dist}` : ''}`;
  }).join('\n');

  const prompt = `Guide subject: ${category.label} ${entityLabelPlural} in ${where}
Total matching ${entityLabelPlural}: ${matched.length}
Spread across the calendar: ${monthSpread}
Locations represented (${cities.length}): ${cities.slice(0, 20).join(', ')}

Sample of the ${entityLabelPlural} this guide will list:
${sample}

Produce a JSON object with:

- title (string, under 70 characters): a natural page title someone would actually search for.
- intro (string, 3-4 sentences, 80-130 words): open with what is distinctive about this particular set -- ` +
    `a season that dominates the calendar, a city that anchors it, how much the entries vary in scale or ` +
    `setting. Then give the reader the practical shape of it: when the busy months fall, what the range of ` +
    `options looks like, what they'd be choosing between. Ground every claim in the data above.
- editorial_notes is NOT needed.
- faqs (array of exactly 3 objects, each {"question": string, "answer": string}): questions someone ` +
    `comparing these ${entityLabelPlural} would genuinely type into a search box -- about timing, ` +
    `conditions, choosing between options, what to expect. Answer each in a direct 45-70 words using only ` +
    `what the data above supports. No questions about how the guide is compiled.

Output ONLY the JSON object.`;

  return { system, prompt };
}

export function buildResearchPrompt({ siteConfig, entity }) {
  const { entityLabelSingular } = siteConfig;
  const facts = entity.core_facts ?? {};
  const location = [facts.city, facts.country].filter(Boolean).join(', ');

  const system =
    `You are a research assistant gathering first-hand public commentary about a specific ${entityLabelSingular} ` +
    `for a directory listing. Search the web and read what participants, reviewers and reporters have actually ` +
    `written. ${NO_INVENTION_RULE} Every quote you return must be something you genuinely found at a URL you ` +
    'can cite -- never compose, paraphrase into quotation marks, or reconstruct a plausible-sounding review. ' +
    'Returning an empty list is the correct answer when the web has nothing substantive to say. Respond with ' +
    'ONLY valid JSON -- no markdown code fences, no commentary.';

  const prompt = `${entityLabelSingular}: ${entity.name}
${location ? `Location: ${location}\n` : ''}${facts.date ? `Date: ${facts.date}\n` : ''}${facts.organizer ? `Organizer: ${facts.organizer}\n` : ''}
Search for what people say about this ${entityLabelSingular} -- participant race reports, reviews, news coverage, ` +
    `running-community discussion. Prioritise recent editions of this same event.

Return a JSON object with:

- excerpt_quotes (array of 0-5 objects {"quote": string (under 300 chars, verbatim), "attribution": string ` +
    `(who said it and where, e.g. "Runner review on AhoTu"), "source_url": string (the actual page URL)}): ` +
    `direct quotes carrying real information -- course conditions, organisation, atmosphere, heat, crowd ` +
    `support, value. Skip anything purely promotional. Omit any quote you cannot attribute to a real URL.
- highlights (array of 0-5 short strings): concrete, useful things a prospective participant should know, ` +
    `each grounded in what you found (e.g. course profile, weather at that time of year, cut-off times, ` +
    `logistics). Not marketing language.
- watchouts (array of 0-4 short strings): genuine caveats reported by participants.
- sentiment_scores (object {"overall": number 0-100, "breakdown": [{"label": string, "score": number 0-100}]} ` +
    `or null): only if you found enough opinion to justify it. Use null rather than guessing. Breakdown labels ` +
    `should reflect what people actually commented on.
- research_confidence ("high" | "medium" | "low"): how much substantive material you actually found.

Output ONLY the JSON object.`;

  return { system, prompt };
}

/**
 * Writes a full long-form REVIEW ARTICLE (data/reviews/*.json) for one
 * entity. Unlike buildSummaryPrompt (which produces the short listing copy),
 * this asks for a structured, cited, magazine-style review the reader lands
 * on directly -- the readable counterpart to the facts page.
 *
 * Two hard constraints make it safe to publish automatically:
 *   1. Copyright: the prose must be original synthesis. Third-party wording
 *      appears ONLY as short (<= ~18 word) attributed pull_quotes, each with
 *      a real source_url. No copying sentences out of a source into the body.
 *   2. Attribution: every factual/opinion claim in the body carries a [n]
 *      citation that maps to a numbered `sources` entry. generate-reviews.js
 *      drops the article if any [n] fails to resolve, so an uncited draft is
 *      never written -- the model is told this up front.
 *
 * The entity's existing research (quotes/highlights/watchouts/sentiment) is
 * handed over as seed material, and the model is also given web search to
 * corroborate and deepen it, so a review is grounded in real reporting
 * rather than the model's priors.
 */
export function buildReviewArticlePrompt({ siteConfig, entity }) {
  const { entityLabelSingular, siteName } = siteConfig;
  const facts = entity.core_facts ?? {};
  const location = [facts.city, facts.country].filter(Boolean).join(', ');

  const seedQuotes =
    entity.excerpt_quotes?.length > 0
      ? entity.excerpt_quotes.map((q) => `- "${q.quote}" — ${q.attribution} (${q.source_url})`).join('\n')
      : '(none on file)';
  const seedHighlights = entity.research_highlights?.length > 0 ? entity.research_highlights.map((h) => `- ${h}`).join('\n') : '(none on file)';
  const seedWatchouts = entity.research_watchouts?.length > 0 ? entity.research_watchouts.map((w) => `- ${w}`).join('\n') : '(none on file)';

  const system =
    `You are a running writer producing an independent review article for ${siteName}, a ${entityLabelSingular} ` +
    `directory. Write the way a knowledgeable enthusiast magazine would: specific, honest, useful to someone ` +
    `deciding whether to enter. ${NO_INVENTION_RULE}\n\n` +
    'COPYRIGHT AND ATTRIBUTION -- non-negotiable:\n' +
    '- All body prose must be YOUR OWN original synthesis. Never copy or lightly reword a sentence from a source ' +
    'into the article body.\n' +
    '- The ONLY verbatim third-party text allowed is inside pull_quotes: each must be a short excerpt (18 words ' +
    'or fewer), genuinely found at a real URL, with attribution and that source_url. Omit any quote you cannot ' +
    'attribute to a real page. Never fabricate or paraphrase-into-quotation-marks.\n' +
    '- Every factual or opinion claim in a paragraph must end with a citation marker: [n], where n is the 1-based ' +
    'position of an entry in your own `sources` array (a comma list like [1,2] is allowed when two sources back ' +
    'the same claim). NEVER output <cite> tags, and NEVER use hyphenated markers like [16-8] or [11-3] -- those ' +
    'are internal search artifacts and are forbidden. Only cite a source you actually list, and only attach a ' +
    'citation to a claim that source genuinely states. Use the official site for dates/prices and reviews/reports ' +
    'for experience.\n' +
    '- State the event\'s date (given in core_facts) explicitly somewhere in the article.\n' +
    '- Never paste raw lists of tags, facets or filter labels (e.g. words separated by " · ") as prose -- write ' +
    'sentences. Keep numbers internally consistent (e.g. the 1st-place prize must be the largest).\n' +
    '- Do not describe how this article was assembled, researched, generated or scored.\n' +
    'Respond with ONLY valid JSON -- no markdown code fences, no commentary.';

  const prompt = `Write a review article about this ${entityLabelSingular}.

${entityLabelSingular}: ${entity.name}
${location ? `Location: ${location}\n` : ''}${facts.date ? `Date: ${facts.date}\n` : ''}Known facts (core_facts, treat as authoritative for dates/distances/prices): ${JSON.stringify(facts)}

Seed material already gathered (verify and build on it; search the web for more recent race reports, reviews and news about this event and prior editions):
Quotes on file:
${seedQuotes}
Highlights on file:
${seedHighlights}
Watchouts on file:
${seedWatchouts}

Produce a JSON object with EXACTLY these fields:

- title (string, <= 90 chars): an engaging on-page headline for the review.
- seo_title (string, <= 60 chars): a focused search title, WITHOUT the site name. Include the ${entityLabelSingular} name and the word "review".
- meta_description (string, <= 155 chars): a compelling search-result summary.
- dek (string, 1-2 sentences): a standfirst under the headline.
- verdict (string, 60-110 words): the bottom-line take -- what this ${entityLabelSingular} is like and who it suits.
- rating (object {"overall": 0-100, "breakdown": [{"label","score"}]}) : 3-5 breakdown rows reflecting what people actually comment on (course, organisation, atmosphere, difficulty). Base it on the sentiment in the material; do not invent precision.
- sections (array of 4-6 objects {"heading", "paragraphs": [string,...]}): the body. Each paragraph is plain prose containing inline [n] citation markers. Cover the course/terrain, conditions, organisation/logistics, competitiveness or atmosphere, and a "should you run it" close. Keep paragraphs tight (2-4 sentences).
- pull_quotes (array of 0-3 objects {"quote","attribution","source_url"}): short, attributed, real. 18 words max each.
- sources (array of 2-6 objects {"n": integer, "label", "publisher", "url", "type": one of official|registration_platform|aggregator|review|social|news|other}): every [n] used in the body MUST appear here. Include the official site as one source.
- faqs (array of 3-4 objects {"question","answer"}): real search questions; each answer a direct 40-60 words grounded in the material.

Every [n] in the body must have a matching sources entry, and every source should be cited at least once. Output ONLY the JSON object.`;

  return { system, prompt };
}

export function buildSummaryPrompt({ siteConfig, entity }) {
  const { entityLabelSingular } = siteConfig;

  const system =
    `You are writing the listing copy for one ${entityLabelSingular} on a directory site. Write for someone ` +
    `deciding whether this is right for them -- not for someone auditing your sources. ${NO_INVENTION_RULE} ` +
    'Ground every sentence strictly in the material given below; do not add outside knowledge even if you ' +
    "believe it to be true.\n\n" +
    'Style rules: never describe the listing process itself. Do not mention verification, sources, ' +
    'aggregators, refresh schedules, confidence, or "as of the last check" -- a reader came for the ' +
    `${entityLabelSingular}, not for how the page was assembled. Never state that something is unknown, ` +
    'unannounced or pending; simply leave it out. Never state whether registration/entry is open, closed, ' +
    'sold out or not yet announced, in any field -- that status goes stale between refreshes and the site ' +
    'does not publish it (renderers strip it; see withoutRegistrationClaims in src/lib/text.js). Entry ' +
    'process and prices are fine; the open/closed state is not. Lead with what is distinctive rather than ' +
    'restating the name, date and location in order. Respond with ONLY valid JSON -- no markdown code fences, no commentary.';

  const quotesBlock =
    entity.excerpt_quotes?.length > 0
      ? entity.excerpt_quotes.map((q) => `- "${q.quote}" -- ${q.attribution}`).join('\n')
      : '(none available)';

  const highlightsBlock = entity.research_highlights?.length > 0 ? entity.research_highlights.map((h) => `- ${h}`).join('\n') : '(none available)';
  const watchoutsBlock = entity.research_watchouts?.length > 0 ? entity.research_watchouts.map((w) => `- ${w}`).join('\n') : '(none available)';

  const prompt = `${entityLabelSingular} name: ${entity.name}
Tags: ${(entity.tags ?? []).join(', ') || '(none)'}
core_facts: ${JSON.stringify(entity.core_facts)}

What people report about it (from web research):
${quotesBlock}

Reported highlights:
${highlightsBlock}

Reported watchouts:
${watchoutsBlock}

Using ONLY the information above, produce a JSON object with:

- ai_summary (string, 2-4 sentences, roughly 40-90 words): what this ${entityLabelSingular} is actually like. ` +
    `Where research material exists, lead with it -- terrain, conditions, atmosphere, how it's run -- and treat ` +
    `the structured facts as supporting detail. Where there is no research material, write a plain factual ` +
    `overview from the facts and keep it short rather than padding it.
- short_description (string, one sentence, under 220 characters): a direct-answer opening line.
- pros (array of 2-5 short strings): concrete positives. Prefer ones drawn from reported experience over ones ` +
    `restating a fact (e.g. "Flat, fast course along the river" beats "Offers a full marathon distance").
- cons (array of 1-4 short strings): genuine caveats a participant would want warned about, drawn from the ` +
    `watchouts and quotes. Return an empty array rather than inventing one, and never use "registration ` +
    `details not yet announced" or similar as a con -- missing information is not a drawback.
- faqs (array of 2-4 objects, each {"question": string, "answer": string}): questions someone would genuinely ` +
    `search for about this ${entityLabelSingular}, each answer a direct 40-60 word response. Prefer questions ` +
    `the research material can actually answer ("Is the course hilly?", "How hot does it get?") over ones that ` +
    `just restate the facts back. Never ask or answer whether registration is open, closed or still available ` +
    `-- those are dropped before rendering, so one is a wasted slot out of four.
- sentiment_scores (object {"overall": number 0-100, "breakdown": [{"label": string, "score": number 0-100}]}, ` +
    `or null): only if the quotes above actually convey opinion. Use null rather than guessing.

Output ONLY the JSON object.`;

  return { system, prompt };
}
