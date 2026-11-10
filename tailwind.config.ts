import type { Config } from "tailwindcss"

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        pitch: "#f4f1ea",
        felt: "#ebe6dc",
        card: "#faf8f4",
        line: "#ddd6c8",
        signal: "#0c6b3c",
        ink: "#161815",
        mist: "#5e675f",
        rail: "#161815",
      },
      fontFamily: {
        sans: ["Instrument Sans", "Segoe UI", "sans-serif"],
        display: ["Instrument Serif", "Georgia", "serif"],
      },
    },
  },
  plugins: [],
}

export default config
