/**
 * Pulls a JSON value out of a model response, tolerating the common ways
 * Claude wraps JSON even when explicitly told not to: markdown code fences,
 * a leading/trailing sentence of commentary. Finds the first balanced
 * `{...}` or `[...]` in the text and parses that, rather than assuming the
 * whole response is bare JSON.
 *
 * Split into its own dependency-free module (no @anthropic-ai/sdk import)
 * so this parsing logic can be unit-tested without the SDK installed.
 */
/**
 * Escape control characters (U+0000–U+001F) that appear INSIDE string
 * literals, which is the one thing models reliably get wrong: a literal
 * newline or tab pasted into a string value is invalid JSON ("Bad control
 * character in string literal") even though the braces balance perfectly.
 * Whitespace between tokens (outside strings) is left untouched, so this is
 * a no-op on already-valid JSON.
 */
function escapeControlCharsInStrings(s) {
  let out = '';
  let inString = false;
  let escapeNext = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const code = s.charCodeAt(i);
    if (escapeNext) {
      out += ch;
      escapeNext = false;
      continue;
    }
    if (ch === '\\') {
      out += ch;
      escapeNext = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      out += ch;
      continue;
    }
    if (inString && code < 0x20) {
      if (ch === '\n') out += '\\n';
      else if (ch === '\r') out += '\\r';
      else if (ch === '\t') out += '\\t';
      else out += '\\u' + code.toString(16).padStart(4, '0');
      continue;
    }
    out += ch;
  }
  return out;
}

export function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;

  const start = candidate.search(/[[{]/);
  if (start === -1) {
    throw new Error(`No JSON object/array found in response: ${text.slice(0, 200)}`);
  }
  const openChar = candidate[start];
  const closeChar = openChar === '{' ? '}' : ']';

  let depth = 0;
  let end = -1;
  let inString = false;
  let escapeNext = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (ch === '\\') {
      escapeNext = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === openChar) depth++;
    else if (ch === closeChar) {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) {
    throw new Error(`Unbalanced JSON in response (no matching "${closeChar}" found): ${text.slice(0, 200)}`);
  }

  const jsonSlice = candidate.slice(start, end + 1);
  try {
    return JSON.parse(jsonSlice);
  } catch (err) {
    // One rescue attempt: escape stray control characters inside strings,
    // the most common way an otherwise-well-formed response fails to parse.
    try {
      return JSON.parse(escapeControlCharsInStrings(jsonSlice));
    } catch {
      throw new Error(`Failed to parse extracted JSON: ${err.message}\nExtracted: ${jsonSlice.slice(0, 300)}`);
    }
  }
}
