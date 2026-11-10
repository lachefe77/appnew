import { prisma } from "@/lib/db"
import { SETTING_CATALOG, catalogDefault } from "@/server/setting-catalog"

export async function getSettings() {
  const rows = await prisma.setting.findMany()
  const map = new Map(rows.map((row) => [row.key, row.value]))
  return {
    get(key: string) {
      return map.get(key) ?? catalogDefault(key)
    },
    flag(key: string) {
      return (map.get(key) ?? catalogDefault(key)) === "true"
    },
    num(key: string) {
      const parsed = Number(map.get(key) ?? catalogDefault(key))
      return Number.isFinite(parsed) ? parsed : 0
    },
  }
}

export type SettingsBag = Awaited<ReturnType<typeof getSettings>>
