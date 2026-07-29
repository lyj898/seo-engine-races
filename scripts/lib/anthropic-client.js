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
    client = new Anthropic({ apiKey });
  }
  return client;
}

/** Single non-streaming call to Claude, returns the response's text content. */
export async function callClaude({ system, prompt, maxTokens = 2000, model = DEFAULT_MODEL }) {
  const anthropic = getClient();
  const response = await anthropic.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: prompt }],
  });
  return response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

/**
 * Calls Claude and parses its response as JSON, retrying (once, by default)
 * with a corrective follow-up if the first response isn't valid/parseable
 * JSON. Never silently returns malformed data -- throws after retries are
 * exhausted, so the caller can skip that one item and move on rather than
 * writing garbage to /data.
 */
export async function callClaudeForJson({ system, prompt, maxTokens = 2000, model, retries = 1 }) {
  let lastError;
  let currentPrompt = prompt;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const text = await callClaude({ system, prompt: currentPrompt, maxTokens, model });
    try {
      return extractJson(text);
    } catch (err) {
      lastError = err;
      currentPrompt =
        `${prompt}\n\n---\nYour previous response could not be parsed as JSON (error: "${err.message}"). ` +
        'Respond again with ONLY valid JSON -- no markdown code fences, no commentary before or after it.';
    }
  }
  throw new Error(`callClaudeForJson: exhausted ${retries + 1} attempt(s). Last error: ${lastError.message}`);
}
