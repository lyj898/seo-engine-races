// Shared Tailwind class strings for Pace Lab's calculator form controls.
// Every tool page under src/pages/tools/ imports from here instead of each
// repeating identical class strings, so the form look only needs to change
// in one place.
export const fieldClass =
  'w-full rounded-lg border-[1.5px] border-brand-border bg-brand-bg px-3 py-2.5 text-sm tabular-nums focus:border-brand-primary focus:outline-none disabled:cursor-not-allowed disabled:border-brand-primary disabled:bg-brand-primary-highlight disabled:font-bold disabled:text-brand-primary-ink dark:border-brand-border-dark dark:bg-brand-bg-dark dark:disabled:border-brand-primary-hover dark:disabled:bg-brand-primary-highlight-dark dark:disabled:text-brand-primary-ink-dark';
export const numFieldClass = `text-center ${fieldClass}`;
export const selectClass =
  'rounded-lg border-[1.5px] border-brand-border bg-brand-bg px-2 py-2.5 text-sm focus:border-brand-primary focus:outline-none dark:border-brand-border-dark dark:bg-brand-bg-dark';
export const labelClass = 'mb-1.5 block text-sm font-semibold';
export const subLabelClass = 'mt-1 text-center text-[11px] text-brand-muted dark:text-brand-muted-dark';
export const cardClass =
  'rounded-xl border border-brand-border bg-brand-surface p-5 sm:p-6 dark:border-brand-border-dark dark:bg-brand-surface-dark';
