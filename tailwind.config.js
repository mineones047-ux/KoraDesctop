/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        kora: {
          bg: 'rgb(var(--kora-bg) / <alpha-value>)',
          surface: 'rgb(var(--kora-surface) / <alpha-value>)',
          card: 'rgb(var(--kora-card) / <alpha-value>)',
          border: 'rgb(var(--kora-border) / <alpha-value>)',
          text: 'rgb(var(--kora-text) / <alpha-value>)',
          muted: 'rgb(var(--kora-muted) / <alpha-value>)',
          accent: 'rgb(var(--kora-accent) / <alpha-value>)',
          'accent-hover': 'rgb(var(--kora-accent-hover) / <alpha-value>)',
          'accent-soft': 'rgb(var(--kora-accent-soft) / <alpha-value>)',
          success: 'rgb(var(--kora-success) / <alpha-value>)',
          warning: 'rgb(var(--kora-warning) / <alpha-value>)',
          error: 'rgb(var(--kora-error) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      borderRadius: {
        field: 'var(--kora-radius-field)',
        card: 'var(--kora-radius-card)',
        panel: 'var(--kora-radius-panel)',
      },
      boxShadow: {
        panel: 'var(--kora-shadow-panel)',
        pop: 'var(--kora-shadow-pop)',
      },
      transitionTimingFunction: {
        kora: 'cubic-bezier(0.2, 0, 0, 1)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}