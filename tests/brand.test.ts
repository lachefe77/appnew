import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { expect, it } from "vitest"
import { SETTING_CATALOG } from "@/server/setting-catalog"

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) return walk(full)
    return [full]
  })
}

it("o nome da casa é Fut Surebet", () => {
  expect(SETTING_CATALOG.find((item) => item.key === "brand.name")?.defaultValue).toBe("Fut Surebet")
  const files = [
    ...walk(path.resolve("src")),
    path.resolve("README.md"),
    path.resolve("prisma/seed.ts"),
    path.resolve("prisma/schema.prisma"),
  ]
  for (const file of files) {
    if (!/\.(ts|tsx|md|prisma)$/.test(file)) continue
    const text = readFileSync(file, "utf8")
    if (/\bMone\b|Mone Suribet|monesuribet/i.test(text)) {
      throw new Error(`Nome antigo em ${file}`)
    }
  }
})
