import type { Config } from "tailwindcss";
import typography from '@tailwindcss/typography'; // Import the plugin

const config: Config = {
  content: [
    // Paths from standard Next.js setup
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        // Tell Tailwind to use the CSS variables set by next/font in layout.tsx
        sans: ['var(--font-geist-sans)'],
        // We can optionally define mono here too if needed elsewhere
        // mono: ['var(--font-geist-mono)'],
      },
      // You can add other theme extensions here if needed later
    },
  },
  plugins: [
    typography, // Use the imported plugin
  ],
};
export default config;