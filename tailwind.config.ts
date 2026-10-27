import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#f4f0e7",
        card: "#fffaf3",
        ink: "#1a1714",
        muted: "#6f675e",
        line: "#e4d9c8",
        copper: "#c24d2c",
        copperDark: "#8d3118",
        pine: "#1e4a38",
        pineSoft: "#e6f2eb",
        gold: "#f0d7a2",
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 0 rgba(26,23,20,0.04), 0 18px 40px -28px rgba(26,23,20,0.45)",
      },
    },
  },
  plugins: [],
};

export default config;
