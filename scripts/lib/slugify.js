/**
 * Shared kebab-case slug helper. Matches src/lib/schema/base.js's
 * `slugSchema` pattern (`^[a-z0-9]+(?:-[a-z0-9]+)*$`) exactly, so anything
 * this produces will pass validation without a second normalization pass.
 */
export function slugify(input) {
  return String(input)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining accents left behind by NFKD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}
