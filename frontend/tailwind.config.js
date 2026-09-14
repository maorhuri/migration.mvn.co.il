/** @type {import('tailwindcss').Config} */
import colors from 'tailwindcss/colors';

/**
 * MVN brand scale. Built around the owner's palette:
 *   --color-1 #570f3a (900)  --color-2 #ad1f74 (600)  --color-3 #e052a7 (400)  --color-4 #f0a8d3 (300)
 * Light surfaces use 600-800 for fills and text; dark surfaces use 300/400 for text and rings.
 */
const brand = {
  50: '#fdf2f8',
  100: '#fbe4f1',
  200: '#f5c6e2',
  300: '#f0a8d3',
  400: '#e052a7',
  500: '#c62c85',
  600: '#ad1f74',
  700: '#8a1a5f',
  800: '#6f1449',
  900: '#570f3a',
  950: '#3a0a27',
};

export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'Heebo',
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          '"Segoe UI"',
          'Roboto',
          'Arial',
          'sans-serif',
        ],
        // Heebo follows JetBrains Mono so Hebrew glyphs inside mono runs ("2.0 שנ׳", console section
        // headers) come from the UI face instead of a random system fallback; Latin and digits stay mono.
        mono: [
          '"JetBrains Mono"',
          'Heebo',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Monaco',
          'Consolas',
          '"Liberation Mono"',
          '"Courier New"',
          'monospace',
        ],
      },
      colors: {
        brand,
        // Pages historically reference `primary-*`; it is the brand scale.
        primary: brand,
        // Semantic aliases (use the semantic name in new code; the raw scale still works).
        success: colors.emerald,
        warning: colors.amber,
        danger: colors.rose,
        info: colors.sky,
        // Panel identity colors.
        enhance: colors.violet,
        directadmin: colors.blue,
        cpanel: colors.orange,
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }], // 11px
      },
      borderRadius: {
        lg: '0.625rem', // 10px: inputs, buttons
        xl: '0.875rem', // 14px: cards, modals, tables
        '2xl': '1rem',
      },
      boxShadow: {
        sm: '0 1px 2px 0 rgb(15 23 42 / 0.03)',
        card: 'none',
        pop: '0 8px 24px -12px rgb(15 23 42 / 0.18), 0 0 0 1px rgb(15 23 42 / 0.04)',
        'pop-dark': '0 12px 32px -16px rgb(0 0 0 / 0.7)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.97)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'indeterminate': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(300%)' },
        },
        'indeterminate-rtl': {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(-300%)' },
        },
        'rise-in': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'shimmer': {
          from: { transform: 'translateX(-100%)' },
          to: { transform: 'translateX(100%)' },
        },
        'ring-pop': {
          '0%': { transform: 'scale(0.6)', opacity: '0' },
          '60%': { transform: 'scale(1.05)', opacity: '1' },
          '100%': { transform: 'scale(1)' },
        },
        'dash': {
          to: { strokeDashoffset: '-24' },
        },
        'bar-slide': {
          from: { backgroundPosition: '200% 0' },
          to: { backgroundPosition: '-200% 0' },
        },
        'cursor-blink': {
          '0%, 49%': { opacity: '1' },
          '50%, 100%': { opacity: '0' },
        },
        'log-in': {
          from: { opacity: '0', transform: 'translateY(2px)' },
          to: { opacity: '1', transform: 'none' },
        },
        'log-flash': {
          from: { backgroundColor: 'rgb(198 44 133 / 0.35)' },
          to: { backgroundColor: 'transparent' },
        },
        'draw': {
          to: { strokeDashoffset: '0' },
        },
        'pulse-ring': {
          from: { boxShadow: '0 0 0 0 rgb(198 44 133 / 0.45)' },
          to: { boxShadow: '0 0 0 8px rgb(198 44 133 / 0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out',
        'scale-in': 'scale-in 150ms ease-out',
        'indeterminate': 'indeterminate 1.4s ease-in-out infinite',
        'indeterminate-rtl': 'indeterminate-rtl 1.4s ease-in-out infinite',
        'rise': 'rise-in 360ms cubic-bezier(0.22,1,0.36,1) both',
        'shimmer': 'shimmer 1.6s ease-in-out infinite',
        'ring-pop': 'ring-pop 500ms cubic-bezier(0.22,1,0.36,1) both',
        'dash': 'dash 1s linear infinite',
        'bar-slide': 'bar-slide 2.4s linear infinite',
        'cursor-blink': 'cursor-blink 1s steps(1) infinite',
        'log-in': 'log-in 220ms ease-out',
        'log-flash': 'log-flash 1.6s ease-out',
        'draw': 'draw 600ms ease-out forwards',
        'pulse-ring': 'pulse-ring 1.4s ease-out infinite',
      },
      transitionDuration: {
        DEFAULT: '150ms',
      },
    },
  },
  plugins: [],
}
