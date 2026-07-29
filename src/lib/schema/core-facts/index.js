import { z } from 'zod';
import { racesCoreFactsSchema } from './races.js';
import { hotelsCoreFactsSchema } from './hotels.js';
import { localServicesCoreFactsSchema } from './local-services.js';
import { coursesCoreFactsSchema } from './courses.js';
import { eventPlanningCoreFactsSchema } from './event-planning.js';

/**
 * Registry keyed by site.config.json's `verticalKey`. This is the ONE place
 * that maps a vertical to its core_facts shape. Adding a 6th vertical means
 * adding one file in this directory + one line here -- never touching
 * base.js or any shared route/component.
 */
export const coreFactsRegistry = {
  races: racesCoreFactsSchema,
  hotels: hotelsCoreFactsSchema,
  'local-services': localServicesCoreFactsSchema,
  courses: coursesCoreFactsSchema,
  'event-planning': eventPlanningCoreFactsSchema,
};

// Unknown verticals fall back to an open/passthrough schema rather than
// failing outright -- lets a 6th vertical be prototyped with seed data
// before its formal core_facts schema is written.
const fallbackSchema = z.record(z.any());

export function getCoreFactsSchema(verticalKey) {
  return coreFactsRegistry[verticalKey] ?? fallbackSchema;
}
