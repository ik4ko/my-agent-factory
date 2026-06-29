import type { Config } from 'tailwindcss';

export default {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        body:     ['var(--font-inter)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        headline: ['var(--font-display)', 'var(--font-inter)', 'ui-sans-serif', 'sans-serif'],
        mono:     ['var(--font-mono)', 'JetBrains Mono', 'Fira Mono', 'ui-monospace', 'monospace'],
        code:     ['var(--font-mono)', 'JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      colors: {
        /* ── Semantic tokens (CSS variables) ─────────────── */
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT:    'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT:    'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT:    'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT:    'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT:    'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT:    'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT:    'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        warning: {
          DEFAULT:    'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
        },
        border: 'hsl(var(--border))',
        input:  'hsl(var(--input))',
        ring:   'hsl(var(--ring))',

        /* ── Surface depth ───────────────────────────────── */
        surface: {
          '1': 'hsl(var(--surface-1))',
          '2': 'hsl(var(--surface-2))',
          '3': 'hsl(var(--surface-3))',
        },

        /* ── Neon palette ────────────────────────────────── */
        neon: {
          green:  'hsl(var(--neon-green))',
          cyan:   'hsl(var(--neon-cyan))',
          purple: 'hsl(var(--neon-purple))',
          orange: 'hsl(var(--neon-orange))',
          red:    'hsl(var(--neon-red))',
        },

        /* ── Charts ──────────────────────────────────────── */
        chart: {
          '1': 'hsl(var(--chart-1))',
          '2': 'hsl(var(--chart-2))',
          '3': 'hsl(var(--chart-3))',
          '4': 'hsl(var(--chart-4))',
          '5': 'hsl(var(--chart-5))',
        },

        /* ── Sidebar ─────────────────────────────────────── */
        sidebar: {
          DEFAULT:             'hsl(var(--sidebar-background))',
          foreground:          'hsl(var(--sidebar-foreground))',
          primary:             'hsl(var(--sidebar-primary))',
          'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
          accent:              'hsl(var(--sidebar-accent))',
          'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
          border:              'hsl(var(--sidebar-border))',
          ring:                'hsl(var(--sidebar-ring))',
        },
      },
      borderRadius: {
        sm:   'calc(var(--radius) - 4px)',
        md:   'calc(var(--radius) - 2px)',
        lg:   'var(--radius)',
        xl:   'calc(var(--radius) + 4px)',
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
      boxShadow: {
        'neon-green':  '0 0 8px hsl(var(--neon-green) / 0.5), 0 0 24px hsl(var(--neon-green) / 0.2)',
        'neon-cyan':   '0 0 8px hsl(var(--neon-cyan) / 0.5), 0 0 24px hsl(var(--neon-cyan) / 0.2)',
        'neon-purple': '0 0 8px hsl(var(--neon-purple) / 0.5), 0 0 24px hsl(var(--neon-purple) / 0.2)',
        'neon-red':    '0 0 8px hsl(var(--neon-red) / 0.5), 0 0 24px hsl(var(--neon-red) / 0.2)',
        'neon-sm':     '0 0 4px currentColor',
        'card-lift':   '0 4px 24px hsl(0 0% 0% / 0.4)',
      },
      keyframes: {
        /* ── Existing ──────────────────────────────────────── */
        'accordion-down': {
          from: { height: '0' },
          to:   { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to:   { height: '0' },
        },
        /* ── Cyberpunk additions ───────────────────────────── */
        'glow-pulse': {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0.35' },
        },
        'agent-ping': {
          '75%, 100%': { transform: 'scale(2.2)', opacity: '0' },
        },
        flicker: {
          '0%, 19%, 21%, 23%, 25%, 54%, 56%, 100%': { opacity: '1' },
          '20%, 24%, 55%':                           { opacity: '0.35' },
        },
        'fade-in-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in-right': {
          from: { opacity: '0', transform: 'translateX(8px)' },
          to:   { opacity: '1', transform: 'translateX(0)' },
        },
        shimmer: {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition:  '200% 0' },
        },
      },
      animation: {
        'accordion-down':   'accordion-down 0.2s ease-out',
        'accordion-up':     'accordion-up 0.2s ease-out',
        'glow-pulse':       'glow-pulse 2s ease-in-out infinite',
        'agent-ping':       'agent-ping 1.2s cubic-bezier(0, 0, 0.2, 1) infinite',
        flicker:            'flicker 5s linear infinite',
        'fade-in-up':       'fade-in-up 0.3s ease-out both',
        'slide-in-right':   'slide-in-right 0.25s ease-out both',
        shimmer:            'shimmer 2s linear infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
} satisfies Config;
