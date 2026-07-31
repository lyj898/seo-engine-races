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

  const system =
    `You are a careful research assistant extracting structured directory listings for a "${entityLabelPlural}" ` +
    `directory website. ${NO_INVENTION_RULE}${constraints ? ` Scope restriction: ${constraints}` : ''} Respond ` +
    'with ONLY valid JSON -- no markdown code fences, no commentary before or after it.';

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

export function buildSummaryPrompt({ siteConfig, entity }) {
  const { entityLabelSingular } = siteConfig;

  const system =
    `You are a factual copywriter producing directory-listing content for a "${entityLabelSingular}" directory ` +
    `website. ${NO_INVENTION_RULE} Ground every sentence, pro, con, and FAQ answer strictly in the structured ` +
    'facts and quotes given below -- do not add outside knowledge, even if you believe it to be true. Respond ' +
    'with ONLY valid JSON -- no markdown code fences, no commentary.';

  const quotesBlock =
    entity.excerpt_quotes?.length > 0
      ? entity.excerpt_quotes.map((q) => `- "${q.quote}" -- ${q.attribution}`).join('\n')
      : '(none available)';

  const prompt = `${entityLabelSingular} name: ${entity.name}
Tags: ${(entity.tags ?? []).join(', ') || '(none)'}
core_facts: ${JSON.stringify(entity.core_facts)}
Source excerpt quotes:
${quotesBlock}

Using ONLY the information above, produce a JSON object with:

- ai_summary (string, 2-4 sentences, roughly 40-90 words): a clear, factual overview a reader would want as ` +
    `their first read of this ${entityLabelSingular}.
- short_description (string, one sentence, under 220 characters): a direct-answer opening line.
- pros (array of 2-5 short strings): genuine positives supported by the facts/quotes above.
- cons (array of 1-4 short strings): genuine caveats/downsides supported by the facts/quotes above. If nothing ` +
    `in the source material supports a con, return an empty array rather than inventing one.
- faqs (array of 2-4 objects, each {"question": string, "answer": string}): natural questions a reader would ` +
    `ask, each answer a direct, factual, 40-60 word response grounded only in the facts/quotes above.
- sentiment_scores (object {"overall": number 0-100, "breakdown": [{"label": string, "score": number 0-100}]}, ` +
    `or null): only include this if the source excerpt quotes actually convey sentiment/opinion. If there are ` +
    `no quotes to ground a sentiment score in, use null rather than guessing.

Output ONLY the JSON object.`;

  return { system, prompt };
}
