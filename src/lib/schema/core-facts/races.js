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
  // The date entries actually shut. registration_status alone is a snapshot
  // with no expiry -- an entity stamped "open" in June still reads "open" in
  // August, which is how the site came to tell readers they could enter the
  // Sarawak Energy Marathon five weeks after its 30 June deadline. That is
  // why the status itself is no longer published at all (see
  // withoutRegistrationClaims in src/lib/text.js); the deadline is, because
  // a stored date is a claim a reader can check against today for
  // themselves. Both fields are still stored and still refreshed --
  // scripts/validate-data.js compares them to flag records that contradict
  // themselves.
  //
  // Format is enforced (unlike `date`, which predates this and carries real
  // data in looser shapes) because every value of this field is new: a
  // deadline that can't be compared to today is worse than no deadline,
  // since it reads as authoritative while silently never expiring anything.
  registration_deadline: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be an ISO date, e.g. "2026-06-30"')
    .optional()
    .describe(
      'ISO date (YYYY-MM-DD) that entries close, e.g. "2026-06-30". Only set this when a source states the closing date explicitly; omit it entirely rather than guessing from the race date, since a wrong deadline silently marks a still-open race as closed.'
    ),
  price_range: z.string().optional(), // free-form, e.g. "THB 800-1,500"
  venue: z.string().optional(),
  city: z.string().optional(),
  country: z.string().min(1),
});
