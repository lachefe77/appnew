import type { Config } from "tailwindcss"

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        pitch: "#07140f",
        felt: "#0d1f18",
        card: "#12281e",
        line: "#234838",
        signal: "#1ed37a",
        ink: "#f4faf6",
        mist: "#93b0a2",
        rail: "#121816",
      },
      fontFamily: {
        sans: ["Outfit", "Segoe UI", "sans-serif"],
        display: ["Barlow Condensed", "Outfit", "sans-serif"],
      },
    },
  },
  plugins: [],
}

export default config
