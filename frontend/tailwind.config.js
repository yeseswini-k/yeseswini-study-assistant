/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          950: '#030712',
          900: '#0a0e1a',
          800: '#111827',
          700: '#1f2937',
          600: '#374151',
        },
        gold: {
          DEFAULT: '#bf953f',
          light: '#fcf6ba',
          dark: '#b38728',
          accent: '#d4af37',
        }
      },
      fontFamily: {
        academic: ['Playfair Display', 'serif'],
        sans: ['Outfit', 'sans-serif'],
      },
      animation: {
        'pulse-slow': 'pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      }
    },
  },
  plugins: [],
}
