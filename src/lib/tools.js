// Single source of truth for Pace Lab's calculators. The hub page
// (src/pages/tools/index.astro), the cross-link component, and the
// sitemap all read this list rather than each repeating slugs/labels
// independently -- adding a 6th tool is one entry here plus one new page.
//
// `legacyHash` is the #fragment key each tool used back when all five
// lived on one JS-tabbed /tools/ page -- kept so the hub can redirect
// anyone arriving via an old #hash link straight to the tool's real URL.
export const TOOLS = [
  {
    slug: 'pace-calculator',
    legacyHash: 'pace',
    navLabel: 'Pace Calculator',
    hubDescription: 'Solve for pace, finish time, or distance -- fill in the two you already know.',
  },
  {
    slug: 'race-time-predictor',
    legacyHash: 'predictor',
    navLabel: 'Race Time Predictor',
    hubDescription: 'Turn one recent race result into predicted times at other distances, plus training paces.',
  },
  {
    slug: 'race-splits-calculator',
    legacyHash: 'splits',
    navLabel: 'Race Splits Calculator',
    hubDescription: 'Build a printable km/mile split chart from your goal finish time.',
  },
  {
    slug: 'race-countdown-timer',
    legacyHash: 'countdown',
    navLabel: 'Race Countdown Timer',
    hubDescription: 'Count down the days to race day and see a general taper window.',
  },
  {
    slug: 'calories-burned-calculator',
    legacyHash: 'calories',
    navLabel: 'Calories Burned Calculator',
    hubDescription: 'Estimate calories burned for a run from your body weight and distance.',
  },
];
