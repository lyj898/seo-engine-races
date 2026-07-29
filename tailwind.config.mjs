import siteConfig from './site.config.json' with { type: 'json' };

// Tailwind config is a plain Node module, so -- like astro.config.mjs -- it
// can import site.config.json directly. This is the ONE place a vertical
// instance's palette/type/radius tokens (site.config.json.theme) become
// real CSS: every component uses `bg-brand-*` / `text-brand-*` /
// `border-brand-*` classes (light) with a `dark:`-prefixed `-dark` variant
// (dark), so a site's whole visual identity is a config edit, never a
// component edit. `pick()` fallbacks below mean a brand-new vertical
// instance still gets a working, readable build even before every optional
// token is filled in.
const theme = siteConfig.theme ?? {};
const light = theme.light ?? {};
const dark = theme.dark ?? {};
const fonts = theme.fonts ?? {};
const radius = theme.radius ?? {};

function pick(value, fallback) {
  return value ?? fallback;
}

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./src/**/*.{astro,html,js,jsx,ts,tsx,md,mdx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: pick(theme.primaryColor, '#2f6f4f'),

          bg: pick(light.bg, '#faf9f6'),
          surface: pick(light.surface, '#ffffff'),
          'surface-offset': pick(light.surfaceOffset, '#f0efe9'),
          divider: pick(light.divider, pick(light.border, '#e4e2dc')),
          border: pick(light.border, '#e4e2dc'),
          text: pick(light.text, '#15170f'),
          muted: pick(light.muted, '#6b6f68'),
          faint: pick(light.faint, pick(light.muted, '#9a9d94')),
          'primary-ink': pick(light.primaryInk, '#ffffff'),
          'primary-highlight': pick(light.primaryHighlight, '#e5f0ea'),
          'primary-hover': pick(light.primaryHover, pick(theme.primaryColor, '#2f6f4f')),
          success: pick(light.success, '#2f7a3a'),
          'success-highlight': pick(light.successHighlight, '#d7ecd0'),
          warning: pick(light.warning, '#a15c00'),
          'warning-highlight': pick(light.warningHighlight, '#fdf0d8'),
          error: pick(light.error, '#b3261e'),

          'bg-dark': pick(dark.bg, '#12140f'),
          'surface-dark': pick(dark.surface, '#1a1d17'),
          'surface-offset-dark': pick(dark.surfaceOffset, '#20231d'),
          'divider-dark': pick(dark.divider, pick(dark.border, '#2b2e27')),
          'border-dark': pick(dark.border, '#2b2e27'),
          'text-dark': pick(dark.text, '#f1f1ec'),
          'muted-dark': pick(dark.muted, '#9a9d94'),
          'faint-dark': pick(dark.faint, pick(dark.muted, '#6d6f5f')),
          'primary-ink-dark': pick(dark.primaryInk, '#ffffff'),
          'primary-highlight-dark': pick(dark.primaryHighlight, '#1e2a22'),
          'primary-hover-dark': pick(dark.primaryHover, pick(theme.primaryColor, '#2f6f4f')),
          'success-dark': pick(dark.success, '#7ec788'),
          'success-highlight-dark': pick(dark.successHighlight, '#1e3122'),
          'warning-dark': pick(dark.warning, '#e0a752'),
          'warning-highlight-dark': pick(dark.warningHighlight, '#392c17'),
          'error-dark': pick(dark.error, '#e0736c'),
        },
      },
      fontFamily: {
        // Class names stay `font-sans` / `font-serif` for backward
        // compatibility with every page/component already using them --
        // only the underlying font *values* are config-driven.
        sans: [pick(fonts.body, 'Inter'), pick(fonts.bodyFallback, 'ui-sans-serif, system-ui, sans-serif')],
        serif: [pick(fonts.display, 'Fraunces'), pick(fonts.displayFallback, 'ui-serif, Georgia, serif')],
      },
      borderRadius: {
        sm: pick(radius.sm, '0.25rem'),
        md: pick(radius.md, '0.375rem'),
        lg: pick(radius.lg, '0.5rem'),
        xl: pick(radius.xl, '0.75rem'),
      },
      boxShadow: {
        sm: '0 1px 2px rgba(21,23,15,.05)',
        md: '0 6px 20px rgba(21,23,15,.08)',
        lg: '0 18px 48px rgba(21,23,15,.14)',
      },
      transitionTimingFunction: {
        interactive: 'cubic-bezier(0.16,1,0.3,1)',
      },
    },
  },
  plugins: [],
};
