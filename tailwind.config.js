/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
    "./src/renderer/index.html"
  ],
  theme: {
    extend: {
      colors: {
        'primary': '#3b82f6',
        'primary-dark': '#2563eb',
        'secondary': '#64748b',
        'accent': '#10b981',
        'accent-dark': '#059669'
      }
    },
  },
  plugins: [],
} 