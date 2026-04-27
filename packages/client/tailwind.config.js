/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        teal: {
          600: '#0d9488',
          700: '#0f766e',
          100: '#ccfbf1',
          50: '#f0fdfa',
        },
        warm: {
          50: '#fafaf9',
          100: '#f5f5f4',
        },
      },
      fontFamily: {
        display: ['"DM Serif Display"', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
