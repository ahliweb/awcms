/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#fff8e6',
          100: '#ffefc2',
          200: '#fde08b',
          300: '#fbc84b',
          400: '#f2b022',
          500: '#b45309',
          600: '#92400e',
          700: '#78350f',
          800: '#5c2a0b',
          900: '#431f08',
        },
        secondary: {
          50: '#fffae5',
          100: '#fef3c2',
          200: '#fde088',
          300: '#f7c95a',
          400: '#e2a92f',
          500: '#a16207',
          600: '#854d0e',
          700: '#6b3f0f',
          800: '#52300b',
          900: '#3b2308',
        },
        accent: {
          DEFAULT: '#b45309',
          light: '#fbc84b',
          dark: '#78350f',
        },
        blue: {
          50: '#fff8e6',
          100: '#ffefc2',
          200: '#fde08b',
          300: '#fbc84b',
          400: '#f2b022',
          500: '#b45309',
          600: '#92400e',
          700: '#78350f',
          800: '#5c2a0b',
          900: '#431f08',
        },
      },
      fontFamily: {
        sans: ['Inter Variable', 'Inter', 'system-ui', 'sans-serif'],
        heading: ['Playfair Display', 'serif'],
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
};
