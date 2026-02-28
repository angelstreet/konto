/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: '#0f0f0f',
        surface: '#1a1a1a',
        'surface-hover': '#242424',
        border: '#2a2a2a',
        muted: '#888888',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [
    function ({ addUtilities, matchUtilities, theme }) {
      // Generate accent color utilities from CSS variables
      const shades = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];
      const utilities = {};
      shades.forEach(shade => {
        utilities[`.text-accent-${shade}`] = { color: `rgb(var(--accent-${shade}))` };
        utilities[`.bg-accent-${shade}`] = { 'background-color': `rgb(var(--accent-${shade}))` };
        utilities[`.border-accent-${shade}`] = { 'border-color': `rgb(var(--accent-${shade}))` };
        // With opacity variants
        utilities[`.bg-accent-${shade}\\/10`] = { 'background-color': `rgb(var(--accent-${shade}) / 0.1)` };
        utilities[`.bg-accent-${shade}\\/20`] = { 'background-color': `rgb(var(--accent-${shade}) / 0.2)` };
        utilities[`.text-accent-${shade}\\/50`] = { color: `rgb(var(--accent-${shade}) / 0.5)` };
        utilities[`.text-accent-${shade}\\/70`] = { color: `rgb(var(--accent-${shade}) / 0.7)` };
        // Hover/focus variants
        utilities[`.hover\\:bg-accent-${shade}:hover`] = { 'background-color': `rgb(var(--accent-${shade}))` };
        utilities[`.hover\\:text-accent-${shade}:hover`] = { color: `rgb(var(--accent-${shade}))` };
        utilities[`.focus\\:border-accent-${shade}:focus`] = { 'border-color': `rgb(var(--accent-${shade}))` };
      });
      addUtilities(utilities);
    },
  ],
};
