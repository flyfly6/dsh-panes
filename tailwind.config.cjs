/** Tailwind config for the Workbench panel (shadcn/ui preset). */
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  // preflight resets base tags globally and would deform the host UI (§2.0d-1).
  corePlugins: { preflight: false },
  darkMode: ['selector', '[data-ds-dark-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        card: 'var(--card)',
        border: 'var(--border)',
        input: 'var(--border)',
        ring: 'var(--accent)',
        primary: { DEFAULT: 'var(--accent)', foreground: '#ffffff' },
        secondary: { DEFAULT: 'var(--muted)', foreground: 'var(--foreground)' },
        muted: { DEFAULT: 'var(--muted)', foreground: 'var(--muted-foreground)' },
        faint: 'var(--faint-foreground)',
        accent: { DEFAULT: 'var(--hover)', foreground: 'var(--foreground)' },
        popover: { DEFAULT: 'var(--background)', foreground: 'var(--foreground)' },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      // IDE density, not marketing density (§2.0d-1). Every step derives from
      // `--wb-font-ui-size` (tailwind.css), so the `fontUiSize` config field
      // scales the whole panel instead of only unclassed text.
      fontSize: {
        '2xs': ['var(--wb-text-2xs)', 'var(--wb-lh-2xs)'],
        xs: ['var(--wb-text-xs)', 'var(--wb-lh-xs)'],
        sm: ['var(--wb-text-sm)', 'var(--wb-lh-sm)'],
        base: ['var(--wb-text-base)', 'var(--wb-lh-base)'],
      },
      spacing: { tab: '42px', crumb: '30px', status: '26px', rail: '52px' },
    },
  },
  plugins: [],
}
