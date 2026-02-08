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
        gold: {
          50: '#fdf8e8',
          100: '#faefc5',
          200: '#f5df8a',
          300: '#f0cf4f',
          400: '#e8be24',
          500: '#d4a812',
          600: '#a8840e',
          700: '#7c610a',
          800: '#504006',
          900: '#282003',
        },
        muted: '#888888',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
