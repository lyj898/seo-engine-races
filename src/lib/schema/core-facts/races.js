import { z } from 'zod';

// core_facts shape for the "races" vertical. Distances are stored as an
// array because a single event (one entity) commonly offers several race
// distances at once -- entity.category_id captures the *marquee* distance
// for hub-page grouping (e.g. "Full Marathon"), while this array is the
// complete, factual list of what's actually on offer.
export const racesCoreFactsSchema = z.object({
  date: z.string().min(1), // ISO date, e.g. "2026-08-01"
  distance_km: z.array(z.number().positive()).min(1),
  primary_distance_km: z.number().positive().optional(),
  elevation_gain_m: z.number().nonnegative().optional(),
  organizer: z.string().optional(),
  registration_status: z.string().optional(), // e.g. "not_yet_announced", "open", "closed"
  price_range: z.string().optional(), // free-form, e.g. "THB 800-1,500"
  venue: z.string().optional(),
  city: z.string().optional(),
  country: z.string().min(1),
});
