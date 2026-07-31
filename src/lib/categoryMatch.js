/**
 * Generic numeric-range category matching. Any vertical that gives its
 * categories a `matchRange: [min, max|null]` (see schema/base.js) can use
 * this to classify a raw core_facts number -- races' distance_km entries,
 * or equally a hotel's star rating, a course's duration in hours, etc. --
 * against the nearest defined category, without any vertical-specific
 * bucketing logic living in /src.
 *
 * Deliberately returns null (not a fallback/nearest-guess) when no
 * category's range contains the value, rather than force-fitting it to the
 * closest range -- an unmatched value should render as a plain, honest
 * "12.3km" pill rather than a mislabeled category guess.
 */
export function matchCategoryByValue(value, categories) {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  for (const category of categories) {
    const range = category.matchRange;
    if (!Array.isArray(range)) continue;
    const [min, max] = range;
    if (value >= min && (max === null || max === undefined || value <= max)) {
      return category;
    }
  }
  return null;
}

// Tailwind class pairs for each badgeVariant, shared by every component that
// renders a category-derived pill/badge so the success/warning/neutral
// mapping only needs to be defined once.
export const BADGE_VARIANT_CLASSES = {
  success: 'bg-brand-success-highlight text-brand-success dark:bg-brand-success-highlight-dark dark:text-brand-success-dark',
  warning: 'bg-brand-warning-highlight text-brand-warning dark:bg-brand-warning-highlight-dark dark:text-brand-warning-dark',
  neutral: 'bg-brand-surface-offset text-brand-muted dark:bg-brand-surface-offset-dark dark:text-brand-muted-dark',
};
