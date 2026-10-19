/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Palette PRIsME (héritée des portails BZ)
        'bz-dark': '#0b1220',
        'bz-dark2': '#0f172a',
        'bz-blue': '#4f46e5',
        'bz-blue2': '#6366f1',
        'bz-amber': '#f59e0b',
        'bz-emerald': '#10b981',
        'bz-light': '#f1f5f9',
        // Touches Titans (accent néon discret)
        'titan-cyan': '#22d3ee',
        'titan-violet': '#a855f7',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        titan: '0 0 0 1px rgba(34,211,238,0.15), 0 8px 30px rgba(79,70,229,0.25)',
      },
    },
  },
  plugins: [],
};
