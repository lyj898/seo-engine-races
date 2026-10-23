// Which menu hub an article is listed on. Training (with the clubs directory)
// takes the training and health articles; Guides takes everything about
// choosing a race, getting there and the running scene. Both hub pages read
// this, so an article always appears on exactly one of them.
export const TRAINING_TOPICS = ['Training & Racing', 'Running Health & Recovery'];

// Articles filed under a culture/travel topic that are really training or
// recovery advice, so they sit with the other training guides.
const TRAINING_SLUGS = new Set([
  'best-cities-southeast-asia-marathon-training',
  'first-5k-to-first-marathon-southeast-asia',
  'hill-training-flat-city-southeast-asia',
  'marathon-training-plan-full-time-job',
  'training-through-monsoon-season-without-losing-your-base',
]);
const HEALTH_SLUGS = new Set([
  'post-marathon-recovery-timeline-what-happens-to-your-body',
  'local-fruits-foods-actually-work-recovery',
]);
// Travel articles, which Guides groups apart from the running-scene pieces
// they share a topic with.
const TRAVEL_SLUGS = new Set([
  'race-cation-southeast-asia-travel-planning-guide',
  'racing-abroad-first-time-what-changes',
  'planning-first-international-race-trip-with-family',
  'what-to-expect-southeast-asia-race-expo',
  'visa-free-racing-across-asean',
  'what-race-weekend-actually-costs-southeast-asia',
]);
const CHOOSING_SLUGS = new Set(['beginners-guide-southeast-asia-race-calendar']);

// 'training' | 'health' | 'choosing' | 'travel' | 'scene'
export function articleShelf(a) {
  if (TRAINING_SLUGS.has(a.slug)) return 'training';
  if (HEALTH_SLUGS.has(a.slug) || a.topic === 'Running Health & Recovery') return 'health';
  if (a.topic === 'Training & Racing') return 'training';
  if (TRAVEL_SLUGS.has(a.slug)) return 'travel';
  if (CHOOSING_SLUGS.has(a.slug) || a.topic === 'The Podium') return 'choosing';
  return 'scene';
}
export const isTrainingArticle = (a) => ['training', 'health'].includes(articleShelf(a));
