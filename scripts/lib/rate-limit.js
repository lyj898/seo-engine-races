/**
 * Per-hostname request throttle, backing site.config.json's
 * sourceConfig.requestDelayMs. Keyed by hostname (not full URL) so multiple
 * pages on the same aggregator site are still spaced out, matching the
 * spirit of "don't hammer one host" rather than a literal per-URL delay.
 */
const lastRequestAt = new Map();

export async function throttle(hostname, delayMs) {
  const last = lastRequestAt.get(hostname);
  const now = Date.now();
  if (last !== undefined) {
    const wait = delayMs - (now - last);
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
  lastRequestAt.set(hostname, Date.now());
}
