import { z } from 'zod';

// core_facts shape for the "hotels" vertical (hotel review / loyalty-program
// guides). See /config-examples/hotels.site.config.json.
export const hotelsCoreFactsSchema = z.object({
  address: z.string().min(1),
  brand: z.string().min(1), // e.g. "Marriott Bonvoy", "World of Hyatt"
  elite_benefits: z.array(z.string()).default([]),
  breakfast: z.string().optional(), // e.g. "Included for Platinum and above"
  lounge: z.string().optional(),
  points_value_notes: z.string().optional(),
});
