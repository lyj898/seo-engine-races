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

/**
 * Does this entity belong on the given category's page?
 *
 * `entity.category_id` is only the entity's MARQUEE category -- for a race
 * offering 42.195/21.1/10/5 km that's "Full Marathon". Judging membership on
 * that field alone means the 5K hub lists nothing at all, because virtually
 * no event's headline distance is 5K even though most events include one.
 * That's exactly what happened here: /categories/5k/ rendered an empty page
 * while the home page's 5K filter matched dozens of races, because the two
 * were asking different questions of the same data.
 *
 * So membership is the union of both signals: the marquee category, plus any
 * category whose matchRange contains one of the entity's numeric core facts.
 * Verticals without matchRange fall back to the marquee category alone, which
 * is the old behaviour.
 */
export function entityMatchesCategory(entity, category, categories = []) {
  if (!entity || !category) return false;
  if (entity.category_id === category.category_id) return true;
  if (!Array.isArray(category.matchRange)) return false;

  const facts = entity.core_facts ?? {};
  for (const value of Object.values(facts)) {
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (typeof item !== 'number') continue;
      if (matchCategoryByValue(item, categories)?.category_id === category.category_id) return true;
    }
  }
  return false;
}

/**
 * Returns a copy of `facts` with every all-numeric array narrowed to the
 * values that fall inside some category's matchRange, sorted largest-first.
 *
 * Source listings routinely bundle extras a directory doesn't cover -- a
 * race event advertising 42.195/21.1/10/3/1 km when the site is about the
 * four standard road distances. Showing the strays makes a listing look
 * like it's about something else. An array whose values match *nothing* is
 * left untouched rather than emptied, so a vertical that hasn't defined
 * matchRanges (or a field that simply isn't category-bucketed) keeps
 * displaying normally instead of silently losing its data.
 */
export function narrowFactsToCategories(facts, categories) {
  if (!facts || typeof facts !== 'object') return facts;
  const out = {};
  for (const [key, value] of Object.entries(facts)) {
    if (Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === 'number')) {
      const matched = value.filter((v) => matchCategoryByValue(v, categories));
      out[key] = (matched.length ? matched : value).slice().sort((a, b) => b - a);
    } else {
      out[key] = value;
    }
  }
  return out;
}

// Tailwind class pairs for each badgeVariant, shared by every component that
// renders a category-derived pill/badge so the success/warning/neutral
// mapping only needs to be defined once.
export const BADGE_VARIANT_CLASSES = {
  success: 'bg-brand-success-highlight text-brand-success dark:bg-brand-success-highlight-dark dark:text-brand-success-dark',
  warning: 'bg-brand-warning-highlight text-brand-warning dark:bg-brand-warning-highlight-dark dark:text-brand-warning-dark',
  neutral: 'bg-brand-surface-offset text-brand-muted dark:bg-brand-surface-offset-dark dark:text-brand-muted-dark',
};
