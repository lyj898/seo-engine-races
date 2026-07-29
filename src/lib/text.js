/**
 * Splits a string containing exactly one `*accent word*` marker into
 * { before, accent, after }, so the home page hero can render one word
 * with a distinct visual treatment (outlined text, matching runsea.run's
 * reference design) without hardcoding which word that is -- it's whatever
 * site.config.json.heroHeadline marks with asterisks.
 *
 * Falls back to { before: text, accent: '', after: '' } if no marker is
 * found, so a vertical instance that skips this optional config field
 * still renders a plain headline instead of breaking.
 */
export function splitAccentWord(text) {
  const match = /^(.*?)\*(.+?)\*(.*)$/.exec(text ?? '');
  if (!match) return { before: text ?? '', accent: '', after: '' };
  const [, before, accent, after] = match;
  return { before, accent, after };
}
