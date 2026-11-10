import path from "node:path"
import { defineConfig } from "vitest/config"

const databaseUrl = "postgresql://futsurebet:futsurebet@127.0.0.1:5432/futsurebet_test"

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    globalSetup: ["./tests/global-setup.ts"],
    setupFiles: ["./tests/env.ts"],
    hookTimeout: 60000,
    testTimeout: 30000,
    env: {
      DATABASE_URL: databaseUrl,
      AUTH_SECRET: "segredo-de-teste-fut-surebet-32",
      BCRYPT_ROUNDS: "4",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
