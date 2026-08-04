/**
 * Shared internal-linking helpers.
 *
 * Every detail page (entity listings, review articles, and anything a future
 * pipeline adds) builds its "related" links through these functions, so the
 * rule "each page links to its neighbours" lives in ONE place and applies
 * automatically to content added later by the refresh/discovery/review
 * pipelines -- no per-page or per-run maintenance.
 *
 * A dense internal mesh (vs. each page being reachable only from its hubs)
 * materially improves crawlability and indexation of the long tail.
 *
 * Vertical-agnostic: only uses `category_id` / `region_id` / `entity_id`,
 * never a vertical-specific word.
 */

const byReliabilityDesc = (a, b) =>
  (b.reliability_score ?? 0) - (a.reliability_score ?? 0);

/**
 * Related entities for a given entity: any editorially-pinned
 * `related_entity_ids` first, then backfilled with same-region /
 * same-category siblings (ranked by reliability) up to `target`.
 *
 * @param {object} entity              the entity whose neighbours we want
 * @param {object[]} publishedEntities all published entities (already filtered)
 * @param {number} target              max related to return (default 6)
 */
export function pickRelatedEntities(entity, publishedEntities, target = 6) {
  const isSelf = (e) => e.entity_id === entity.entity_id;

  const curated = publishedEntities.filter(
    (e) => entity.related_entity_ids?.includes(e.entity_id) && !isSelf(e)
  );

  const result = [...curated];
  const picked = new Set([entity.entity_id, ...curated.map((e) => e.entity_id)]);
  const pool = publishedEntities.filter((e) => !isSelf(e)).sort(byReliabilityDesc);

  const backfill = (candidates) => {
    for (const e of candidates) {
      if (result.length >= target) break;
      if (picked.has(e.entity_id)) continue;
      picked.add(e.entity_id);
      result.push(e);
    }
  };

  // Priority: same category AND region (most relevant) -> same category -> same region.
  backfill(pool.filter((e) => e.category_id === entity.category_id && e.region_id === entity.region_id));
  backfill(pool.filter((e) => e.category_id === entity.category_id));
  backfill(pool.filter((e) => e.region_id === entity.region_id));

  return result;
}

/**
 * Related review articles for a given reviewed entity: other published reviews
 * whose reviewed entity shares this entity's category or region. Keeps the
 * review cluster interlinked instead of each review being an island.
 *
 * @param {object} entity            the reviewed entity
 * @param {object[]} publishedReviews all published reviews (already filtered)
 * @param {Map} entityById           entity_id -> entity, for the review's target
 * @param {number} target            max related reviews to return (default 4)
 * @returns {{review: object, entity: object}[]}
 */
export function pickRelatedReviews(entity, publishedReviews, entityById, target = 4) {
  const result = [];
  const seen = new Set();

  const consider = (predicate) => {
    for (const r of publishedReviews) {
      if (result.length >= target) break;
      if (seen.has(r.slug)) continue;
      const e = entityById.get(r.entity_id);
      if (!e || e.entity_id === entity.entity_id) continue;
      if (predicate(e)) {
        seen.add(r.slug);
        result.push({ review: r, entity: e });
      }
    }
  };

  consider((e) => e.category_id === entity.category_id && e.region_id === entity.region_id);
  consider((e) => e.category_id === entity.category_id);
  consider((e) => e.region_id === entity.region_id);

  return result;
}
