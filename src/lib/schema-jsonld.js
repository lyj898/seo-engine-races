/**
 * Schema.org JSON-LD builders. Every builder is a pure function -- data in,
 * plain object out -- so pages call these instead of hand-writing schema,
 * and no page ever defines its breadcrumb/FAQ/list data twice (once for
 * display, once for schema). Whether a page actually includes a given
 * schema is gated by site.config.json.enabledFeatures (faqSchema /
 * itemListSchema) at the call site in each page, not in here, so these
 * stay simple and reusable.
 */

/** items: [{ label, href }] (same shape Breadcrumb.astro renders). */
export function buildBreadcrumbListSchema(items, site) {
  if (!items?.length) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.label,
      item: item.href ? new URL(item.href, site).toString() : undefined,
    })),
  };
}

/** faqs: [{ question, answer }] (same shape FAQSection.astro renders). */
export function buildFaqPageSchema(faqs) {
  if (!faqs?.length) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faq.answer,
      },
    })),
  };
}

/**
 * Generic ranked-list schema for hub pages and listicles.
 * items: any array; toUrl(item) and toName(item) extract what's needed --
 * keeps this usable for entities, categories, regions, or listicles alike.
 */
export function buildItemListSchema(items, site, toUrl, toName) {
  if (!items?.length) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: new URL(toUrl(item), site).toString(),
      name: toName(item),
    })),
  };
}

/**
 * Primary entity schema, typed from site.config.json.schemaTypePrimary
 * (e.g. "SportsEvent", "Hotel", "Course", "LocalBusiness", "Service") --
 * never hardcoded per vertical. Property mapping from core_facts is
 * best-effort and generic: a property is only added when the corresponding
 * core_fact actually exists, so this never invents data for a vertical
 * whose core_facts don't happen to include a given concept.
 *
 * Deliberately does NOT map reliability_score to schema.org's
 * `aggregateRating` -- that property specifically means user/reviewer
 * ratings, and reliability_score is a source-verification confidence
 * score, not a review. Misusing aggregateRating would be misleading
 * structured data.
 */
export function buildEntitySchema(entity, siteConfig, url) {
  const facts = entity.core_facts ?? {};
  const schema = {
    '@context': 'https://schema.org',
    '@type': siteConfig.schemaTypePrimary,
    name: entity.name,
    description: entity.short_description,
  };
  if (url) schema.url = url;

  if (facts.date) schema.startDate = facts.date;

  if (facts.venue || facts.city || facts.country) {
    schema.location = {
      '@type': 'Place',
      name: facts.venue || [facts.city, facts.country].filter(Boolean).join(', '),
      address: {
        '@type': 'PostalAddress',
        ...(facts.city ? { addressLocality: facts.city } : {}),
        ...(facts.country ? { addressCountry: facts.country } : {}),
      },
    };
  }

  if (facts.organizer) {
    schema.organizer = { '@type': 'Organization', name: facts.organizer };
  }

  if (facts.price_range) {
    schema.offers = {
      '@type': 'Offer',
      description: facts.price_range,
      ...(url ? { url } : {}),
    };
  }

  return schema;
}

export function buildWebsiteSchema(siteConfig, site) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: siteConfig.siteName,
    description: siteConfig.siteTagline,
    url: site,
  };
}
