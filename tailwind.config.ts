import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#f3f4f6",
        card: "#ffffff",
        ink: "#14181c",
        muted: "#5c6770",
        line: "#e2e5e8",
        copper: "#0f6e56",
        copperDark: "#0b5643",
        pine: "#0f6e56",
        pineSoft: "#e7f4ef",
        gold: "#e7f4ef",
      },
      fontFamily: {
        display: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 0 #0000",
      },
    },
  },
  plugins: [],
};

export default config;
