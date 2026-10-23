// The Lab's tiers, shared by the calculator (RankTool), the per-tier share
// pages (/tools/rank/<distance>/<tier>/) and the share-card images
// (scripts/lab-share-cards.js). `p` is the share of the runner's peer group
// they finish ahead of to reach the tier.
export const TIERS = [
  { name: 'Finisher', slug: 'finisher', p: 0 },
  { name: 'Steady', slug: 'steady', p: 50 },
  { name: 'Strong', slug: 'strong', p: 75 },
  { name: 'Front pack', slug: 'front-pack', p: 90 },
  { name: 'Podium', slug: 'podium', p: 95 },
  { name: 'Elite', slug: 'elite', p: 99 },
];

export const DISTANCE_SLUG = { Half: 'half-marathon', Full: 'marathon', '10K': '10k' };

/** Upper edge of tier i (the next tier's threshold, or 100). */
export const tierCeiling = (i) => TIERS[i + 1]?.p ?? 100;

/** "top 10-25%", "top 1%", "everyone who finishes" */
export function tierBandText(i) {
  const t = TIERS[i];
  if (t.p === 0) return 'the back half of the field';
  const hi = 100 - t.p;
  const lo = 100 - tierCeiling(i);
  return lo === 0 ? `the top ${hi}%` : `the top ${lo}-${hi}%`;
}
