import { z } from 'zod';

// core_facts shape for the "local-services" vertical (plumbers, electricians,
// cleaners, etc). See /config-examples/local-services.site.config.json.
export const localServicesCoreFactsSchema = z.object({
  service_area: z.array(z.string()).default([]),
  response_time: z.string().optional(), // e.g. "Within 1 hour", "Same day"
  price_range: z.string().optional(),
  emergency_availability: z.boolean().optional(),
});
