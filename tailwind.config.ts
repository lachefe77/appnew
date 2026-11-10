import type { Config } from "tailwindcss"

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        pitch: "#07140e",
        felt: "#0d2218",
        card: "#123026",
        line: "#2c4a3a",
        signal: "#f0c14e",
        ink: "#f4f8f5",
        mist: "#9db5a6",
        rail: "#07140e",
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
