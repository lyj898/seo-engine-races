import { z } from 'zod';

// core_facts shape for the "courses" vertical (online courses / bootcamps).
// See /config-examples/courses.site.config.json.
export const coursesCoreFactsSchema = z.object({
  duration: z.string().min(1), // e.g. "12 weeks", "Self-paced"
  modality: z.enum(['online', 'in-person', 'hybrid']),
  price: z.string().optional(),
  certification: z.string().optional(),
  level: z.enum(['beginner', 'intermediate', 'advanced', 'all-levels']).optional(),
});
