import { execSync } from "node:child_process"

const databaseUrl = "postgresql://futsurebet:futsurebet@127.0.0.1:5432/futsurebet_test"

export default function setup() {
  execSync("npx prisma db push --skip-generate --accept-data-loss", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: databaseUrl },
  })
}
