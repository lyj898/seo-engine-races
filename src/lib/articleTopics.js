// Which shelf an article sits on in the Articles hub. After the Nov 2026
// clean-up (125 pieces cut to 23 data-led articles) the shelves are set by
// slug; anything new falls back to its topic.
const SHELF_BY_SLUG = {
  // Choosing a race (the country guides render as "By country" cards instead)
  'southeast-asia-biggest-flagship-marathons-ranked': 'choosing',
  'best-races-first-marathon-half-marathon-southeast-asia': 'choosing',
  // Race data
  'realistic-marathon-finish-time-first-timers': 'data',
  'beginners-guide-southeast-asia-race-calendar': 'data',
  'rise-of-women-only-races-southeast-asia': 'data',
  'what-race-weekend-actually-costs-southeast-asia': 'data',
  'southeast-asia-races-growing-shrinking': 'data',
  // Racing in the heat (training, fuel, kit, start times, Ramadan)
  'training-marathon-heat-humidity-southeast-asia': 'training',
  'electrolytes-and-sodium-beyond-just-water-in-the-heat': 'training',
  'what-to-wear-and-carry-tropical-race': 'training',
  'why-southeast-asia-races-start-before-dawn': 'training',
  'running-through-ramadan-guide-for-muslim-runners': 'training',
  // Running in Southeast Asia
  'why-fun-runs-became-southeast-asias-biggest-race-format': 'scene',
  'why-southeast-asia-runners-obsessed-finisher-medals': 'scene',
  'inside-southeast-asias-run-club-culture': 'scene',
  'southeast-asia-homegrown-running-brands': 'scene',
  // Racing abroad
  'racing-abroad-first-time-what-changes': 'travel',
  'using-a-race-travel-agency-when-a-package-is-worth-it': 'travel',
};

// 'choosing' | 'data' | 'training' | 'scene' | 'travel'
export function articleShelf(a) {
  if (SHELF_BY_SLUG[a.slug]) return SHELF_BY_SLUG[a.slug];
  if (a.topic === 'Training & Racing' || a.topic === 'Running Health & Recovery') return 'training';
  if (a.topic === 'The Podium') return 'choosing';
  return 'scene';
}
