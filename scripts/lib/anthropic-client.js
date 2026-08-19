import Anthropic from '@anthropic-ai/sdk';
import { extractJson } from './json-extract.js';

export { extractJson };

// Overridable via env for testing against a cheaper/newer model without
// editing code; defaults to the current recommended model at time of
// writing this engine.
const DEFAULT_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5';

let client;
function getClient() {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY is not set. Locally: export it in your shell. In GitHub Actions: add it as a repository secret (Settings -> Secrets and variables -> Actions) -- see README\'s "Weekly refresh workflow" section.'
      );
    }
    // Bump retries above the SDK default (2): these pipeline runs are
    // unattended and batchy, so a transient 429/500/529 ("Overloaded") should
    // be ridden out with backoff rather than skipping an entity for the run.
    client = new Anthropic({ apiKey, maxRetries: 6 });
  }
  return client;
}

/**
 * The one place a request is actually issued. Returns stop_reason alongside
 * the text because the two failure modes look identical downstream without
 * it: a model that answered badly, and a model that was answering fine and
 * got cut off at max_tokens. The JSON wrappers below need to tell those
 * apart -- see their truncation handling for why.
 *
 * `tools` is passed straight through so the web-search variant shares this
 * one code path rather than duplicating the response handling.
 */
async function callRaw({ system, prompt, maxTokens, model = DEFAULT_MODEL, tools }) {
  const anthropic = getClient();
  const response = await anthropic.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: prompt }],
    ...(tools ? { tools } : {}),
  });
  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
  return { text, stopReason: response.stop_reason };
}

/** Single non-streaming call to Claude, returns the response's text content. */
export async function callClaude({ system, prompt, maxTokens = 2000, model = DEFAULT_MODEL }) {
  const { text } = await callRaw({ system, prompt, maxTokens, model });
  return text;
}

/**
 * Like callClaude, but gives the model Anthropic's server-side web search
 * tool so it can go and read what the open web says about something,
 * rather than being limited to source text we hand it.
 *
 * This exists because a directory built only from aggregator listings can
 * restate facts (date, distance, venue) and nothing else -- it has no
 * material for "what is this actually like". Search results supply the
 * first-hand reporting that makes a listing worth reading.
 *
 * Searches run server-side, so a single request covers however many
 * queries the model decides to make (bounded by maxSearches) and returns
 * the final answer. Citations come back as separate content blocks; only
 * text blocks are joined here, and the caller is expected to require
 * source URLs inside the JSON payload itself so attribution survives.
 */
export async function callClaudeWithWebSearch({
  system,
  prompt,
  maxTokens = 2000,
  model = DEFAULT_MODEL,
  maxSearches = 4,
}) {
  const { text } = await callRaw({
    system,
    prompt,
    maxTokens,
    model,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: maxSearches }],
  });
  return text;
}

/**
 * Web-search variant of callClaudeForJson. Same retry-on-unparseable
 * contract, so a single bad response skips one item instead of failing a
 * whole run.
 */
export async function callClaudeWithWebSearchForJson({
  system,
  prompt,
  maxTokens = 2000,
  model,
  maxSearches,
  retries = 1,
  maxTokenCeiling = 24000,
}) {
  const errors = [];
  let currentPrompt = prompt;
  let currentMaxTokens = maxTokens;
  let bumps = 0;
  let requests = 0;

  for (let attempt = 0; attempt <= retries; ) {
    requests++;
    const { text, stopReason } = await callRaw({
      system,
      prompt: currentPrompt,
      maxTokens: currentMaxTokens,
      model,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: maxSearches ?? 4 }],
    });

    // Same truncation handling as callClaudeForJson -- and search-backed calls
    // are MORE prone to it, since the search results share the output budget
    // with the answer. The ceiling is higher here for that reason.
    if (stopReason === 'max_tokens') {
      if (currentMaxTokens < maxTokenCeiling && bumps < 2) {
        const raised = Math.min(maxTokenCeiling, currentMaxTokens * 2);
        console.warn(`[anthropic] search response hit max_tokens at ${currentMaxTokens}; retrying with ${raised}.`);
        currentMaxTokens = raised;
        bumps++;
        continue;
      }
      errors.push(`response hit max_tokens at ${currentMaxTokens} (ceiling ${maxTokenCeiling})`);
      break;
    }

    try {
      return extractJson(text);
    } catch (err) {
      errors.push(err.message);
      currentPrompt =
        `${prompt}\n\n---\nYour previous response could not be parsed as JSON (error: "${err.message}"). ` +
        'Respond again with ONLY valid JSON -- no markdown code fences, no commentary before or after it.';
      attempt++;
    }
  }
  throw new Error(
    `callClaudeWithWebSearchForJson: gave up after ${requests} request(s). ` +
      `Errors: ${errors.map((e, i) => `(${i + 1}) ${e}`).join(' | ')}`
  );
}

/**
 * Calls Claude and parses its response as JSON, retrying (once, by default)
 * with a corrective follow-up if the first response isn't valid/parseable
 * JSON. Never silently returns malformed data -- throws after retries are
 * exhausted, so the caller can skip that one item and move on rather than
 * writing garbage to /data.
 */
export async function callClaudeForJson({
  system,
  prompt,
  maxTokens = 2000,
  model,
  retries = 1,
  maxTokenCeiling = 16000,
}) {
  const errors = [];
  let currentPrompt = prompt;
  let currentMaxTokens = maxTokens;
  let bumps = 0;
  let requests = 0;

  for (let attempt = 0; attempt <= retries; ) {
    requests++;
    const { text, stopReason } = await callRaw({ system, prompt: currentPrompt, maxTokens: currentMaxTokens, model });

    // Truncation is a LENGTH problem, and the corrective retry below only
    // fixes FORMATTING problems -- asking a model that ran out of room to
    // "respond again with only JSON" just spends another call producing the
    // same cut-off array. Discovery hit exactly this on 2026-08-18: four
    // sources burned both attempts and returned nothing, and because
    // stop_reason was being discarded the logs blamed malformed JSON.
    //
    // So a truncated response buys more room instead of a scolding, and does
    // not consume a formatting attempt. Bounded: doubling, capped at
    // maxTokenCeiling, at most twice.
    if (stopReason === 'max_tokens') {
      if (currentMaxTokens < maxTokenCeiling && bumps < 2) {
        const raised = Math.min(maxTokenCeiling, currentMaxTokens * 2);
        console.warn(
          `[anthropic] response hit max_tokens at ${currentMaxTokens}; retrying with ${raised}.`
        );
        currentMaxTokens = raised;
        bumps++;
        continue;
      }
      errors.push(`response hit max_tokens at ${currentMaxTokens} (ceiling ${maxTokenCeiling})`);
      break;
    }

    try {
      return extractJson(text);
    } catch (err) {
      errors.push(err.message);
      currentPrompt =
        `${prompt}\n\n---\nYour previous response could not be parsed as JSON (error: "${err.message}"). ` +
        'Respond again with ONLY valid JSON -- no markdown code fences, no commentary before or after it.';
      attempt++;
    }
  }

  // Every attempt's error, not just the last: when the first failure is a
  // truncated array and the retry then returns prose, reporting only the
  // retry sends whoever reads it after the wrong problem entirely.
  throw new Error(
    `callClaudeForJson: gave up after ${requests} request(s). ` +
      `Errors: ${errors.map((e, i) => `(${i + 1}) ${e}`).join(' | ')}`
  );
}
