/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', '"Helvetica Neue"', 'Arial', 'sans-serif'],
        display: ['"Saira Condensed"', 'sans-serif'],
        'serif-text': ['"Cormorant Garamond"', 'serif'],
        'mono-text': ['"JetBrains Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
}
