import { prisma } from "@/lib/db"
import type { BoardSignal } from "@/server/surebet"
import { getSettings, type SettingsBag } from "@/server/settings"

export type AlertChannel = "discord" | "telegram" | "whatsapp"

export function alertMessage(signal: BoardSignal) {
  const percent = signal.profitPercent.toFixed(2).replace(".", ",")
  return `Fut Surebet: ${signal.eventName} · ${signal.market} · ${percent}% · ${signal.leg1.houseName} ${signal.leg1.odd.toFixed(2)} x ${signal.leg2.houseName} ${signal.leg2.odd.toFixed(2)}`
}

export async function deliverAlert(channel: AlertChannel, message: string, settings: SettingsBag) {
  if (channel === "discord") {
    const url = settings.get("alert.discordWebhook").trim()
    if (!url || url.includes("example.invalid")) {
      return { status: "sem_destino" as const, detail: "Webhook do Discord ainda é o exemplo." }
    }
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: message }),
    })
    return response.ok
      ? { status: "enviado" as const, detail: `HTTP ${response.status}` }
      : { status: "falhou" as const, detail: `HTTP ${response.status}` }
  }
  if (channel === "telegram") {
    const token = settings.get("alert.telegramToken").trim()
    const chat = settings.get("alert.telegramChat").trim()
    if (!token || token === "vazio" || !chat || chat === "0") {
      return { status: "sem_destino" as const, detail: "Token ou chat do Telegram vazio." }
    }
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text: message }),
    })
    return response.ok
      ? { status: "enviado" as const, detail: `HTTP ${response.status}` }
      : { status: "falhou" as const, detail: `HTTP ${response.status}` }
  }
  const url = settings.get("alert.whatsappWebhook").trim()
  if (!url || url.includes("example.invalid")) {
    return { status: "sem_destino" as const, detail: "Webhook do WhatsApp ainda é o exemplo." }
  }
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: message }),
  })
  return response.ok
    ? { status: "enviado" as const, detail: `HTTP ${response.status}` }
    : { status: "falhou" as const, detail: `HTTP ${response.status}` }
}

export async function dispatchAlerts(signals: BoardSignal[]) {
  const settings = await getSettings()
  const channel = settings.get("alert.channel").trim().toLowerCase()
  if (channel !== "discord" && channel !== "telegram" && channel !== "whatsapp") {
    return []
  }
  const floor = Number(settings.get("alert.minProfit").replace(",", "."))
  const minimum = Number.isFinite(floor) ? floor : 1
  const fresh: string[] = []
  for (const signal of signals) {
    if (signal.profitPercent < minimum) continue
    const message = alertMessage(signal)
    try {
      await prisma.alertDispatch.create({
        data: { signalKey: signal.key, channel, message, status: "enviando", detail: "" },
      })
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error ? String(error.code) : ""
      if (code === "P2002") continue
      throw error
    }
    let result: { status: "enviado" | "sem_destino" | "falhou"; detail: string }
    try {
      result = await deliverAlert(channel, message, settings)
    } catch (error) {
      result = { status: "falhou", detail: error instanceof Error ? error.message : "Falha ao enviar." }
    }
    await prisma.alertDispatch.update({
      where: { signalKey_channel: { signalKey: signal.key, channel } },
      data: { status: result.status, detail: result.detail },
    })
    fresh.push(signal.key)
  }
  return fresh
}
