import { z } from 'zod';

// core_facts shape for the "event-planning" vertical (party/event vendors:
// planners, entertainers, caterers, venues). See
// /config-examples/event-planning.site.config.json.
export const eventPlanningCoreFactsSchema = z.object({
  capacity: z.string().optional(), // free-form, e.g. "10-150 guests"
  pricing_tier: z.string().optional(),
  lead_time: z.string().optional(), // e.g. "2 weeks notice recommended"
  style_tags: z.array(z.string()).default([]),
  vendor_type: z.string().min(1), // e.g. "Planner", "Entertainer", "Caterer"
});
