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
 * Free browser-based calculator/tool pages (Lab). Deliberately minimal
 * -- no aggregateRating/review property, since none of these tools collect
 * real ratings and fabricating one would be misleading structured data,
 * same principle buildEntitySchema follows for reliability_score.
 */
export function buildWebApplicationSchema({ name, description, url }) {
  if (!name || !url) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name,
    description,
    url,
    applicationCategory: 'HealthApplication',
    operatingSystem: 'Any',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
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
 * The schema.org types that inherit from Event, and so are the only ones
 * allowed to carry `eventStatus` / `eventAttendanceMode` below.
 *
 * Spelled out as a list rather than tested with a substring match on
 * "Event": `EventVenue` is a Place and `EventReservation` a Reservation,
 * so /Event/ would wrongly admit both. And schemaTypePrimary genuinely
 * varies -- the configs in /config-examples use Hotel, Course,
 * LocalBusiness and Service, none of which are Events. Emitting an
 * Event-only property on a Hotel isn't a harmless extra field; it's
 * invalid structured data for the type being declared.
 */
const EVENT_TYPES = new Set([
  'Event',
  'BusinessEvent',
  'ChildrensEvent',
  'ComedyEvent',
  'CourseInstance',
  'DanceEvent',
  'DeliveryEvent',
  'EducationEvent',
  'EventSeries',
  'ExhibitionEvent',
  'Festival',
  'FoodEvent',
  'Hackathon',
  'LiteraryEvent',
  'MusicEvent',
  'PublicationEvent',
  'SaleEvent',
  'ScreeningEvent',
  'SocialEvent',
  'SportsEvent',
  'TheaterEvent',
  'VisualArtsEvent',
]);

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
  const isEvent = EVENT_TYPES.has(siteConfig.schemaTypePrimary);
  const schema = {
    '@context': 'https://schema.org',
    '@type': siteConfig.schemaTypePrimary,
    name: entity.name,
    description: entity.short_description,
  };
  if (url) schema.url = url;

  if (facts.date) schema.startDate = facts.date;

  // The two Event properties Google lists as recommended that are constants
  // rather than data, which is the whole reason they can be added here at
  // all: the others it wants (image, endDate, performer, a numeric
  // offers.price) would have to be invented, and this builder's rule is that
  // a property appears only when the fact behind it exists.
  //
  // EventScheduled asserts only "not cancelled, postponed or rescheduled" --
  // it is not a claim that the date is still ahead, which matters because
  // listings are now kept after their date passes rather than deleted, so
  // plenty of these describe events that have already been run. Went ahead as
  // scheduled is the honest reading for those too. If a vertical ever tracks
  // cancellations, this is the line that reads that fact instead of assuming
  // it.
  if (isEvent) schema.eventStatus = 'https://schema.org/EventScheduled';

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
    // Gated on the physical location it sits next to, not emitted flat: a
    // real venue/city IS the evidence that attendance is in person, so a
    // virtual-event vertical (whose entities carry no venue) never gets
    // told its events are offline.
    if (isEvent) schema.eventAttendanceMode = 'https://schema.org/OfflineEventAttendanceMode';
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

/**
 * Review schema for a single review article. Emits schema.org Review with an
 * itemReviewed of the vertical's primary type (SportsEvent for races), an
 * organisation author/publisher (the site, not a fabricated person), and --
 * only when the article carries a rating -- a reviewRating on a 0-100 scale.
 *
 * This is a genuine editorial review with a byline of the site itself, so
 * Review/reviewRating is the honest structured-data type (unlike
 * reliability_score, which buildEntitySchema deliberately does NOT expose as
 * a rating). entityUrl points back at the reviewed listing so the two nodes
 * are linked for search engines.
 */
export function buildReviewSchema({ review, entity, siteConfig, url, entityUrl, site, includeRating = true }) {
  const facts = entity.core_facts ?? {};
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Review',
    url,
    name: review.seo_title || `${entity.name} review`,
    headline: review.title,
    datePublished: review.last_updated,
    dateModified: review.last_updated,
    author: { '@type': 'Organization', name: siteConfig.siteName, url: site?.toString?.() ?? site },
    publisher: { '@type': 'Organization', name: siteConfig.siteName },
    reviewBody: review.verdict,
    itemReviewed: {
      '@type': siteConfig.schemaTypePrimary,
      name: entity.name,
      ...(entityUrl ? { url: entityUrl } : {}),
      ...(facts.date ? { startDate: facts.date } : {}),
      ...(facts.venue || facts.city || facts.country
        ? {
            location: {
              '@type': 'Place',
              name: facts.venue || [facts.city, facts.country].filter(Boolean).join(', '),
              address: {
                '@type': 'PostalAddress',
                ...(facts.city ? { addressLocality: facts.city } : {}),
                ...(facts.country ? { addressCountry: facts.country } : {}),
              },
            },
          }
        : {}),
    },
  };

  // includeRating is the structured-data half of the gate in
  // src/lib/ratings.js: a Review whose page shows no participant material
  // must not hand a machine-readable score to a search engine either.
  if (includeRating && review.rating && typeof review.rating.overall === 'number') {
    schema.reviewRating = {
      '@type': 'Rating',
      ratingValue: review.rating.overall,
      bestRating: 100,
      worstRating: 0,
    };
  }

  return schema;
}

/**
 * Article schema for Gear buying-guide pages (data/gear/*.json). These
 * aren't reviews of one entity (buildReviewSchema) or the primary vertical
 * type (buildEntitySchema) -- they're independent editorial advice content,
 * so plain schema.org Article with an Organization author/publisher (same
 * "the site itself is the byline" principle buildReviewSchema follows) is
 * the honest structured-data type.
 */
export function buildArticleSchema({ article, siteConfig, url, site }) {
  if (!article || !url) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    url,
    headline: article.title,
    description: article.meta_description || article.dek,
    datePublished: article.published_at || article.last_updated,
    dateModified: article.last_updated,
    author: { '@type': 'Organization', name: siteConfig.siteName, url: site?.toString?.() ?? site },
    publisher: { '@type': 'Organization', name: siteConfig.siteName },
  };
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
