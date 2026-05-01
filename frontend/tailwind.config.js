/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        "fpl-green": "#00ff85",
        "fpl-green-dim": "#00cc6a",
        "fpl-purple": "#38003c",
        "fpl-bg": "#0d0d0d",
        "fpl-card": "#161616",
        "fpl-border": "#2a2a2a",
        "fpl-text": "#e5e7eb",
        "fpl-muted": "#6b7280",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
