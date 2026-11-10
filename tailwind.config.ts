import type { Config } from "tailwindcss"

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        pitch: "#0e1014",
        felt: "#161922",
        card: "#1c2028",
        line: "#313744",
        signal: "#d6a15a",
        ink: "#f4f1ea",
        mist: "#a39e94",
        rail: "#101218",
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
