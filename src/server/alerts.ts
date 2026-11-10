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

export async function dispatchAlerts(signals: BoardSignal[], userId?: string) {
  const settings = await getSettings()
  const channel = settings.get("alert.channel").trim().toLowerCase()
  if (channel !== "discord" && channel !== "telegram" && channel !== "whatsapp") {
    return []
  }
  const floor = Number(settings.get("alert.minProfit").replace(",", "."))
  const globalFloor = Number.isFinite(floor) ? floor : 1
  const user = userId ? await prisma.user.findUnique({ where: { id: userId } }) : null
  const personal = user?.alertMinProfit == null ? null : Number(user.alertMinProfit)
  const minimum = personal != null && Number.isFinite(personal) ? personal : globalFloor
  const cap = Number(settings.get("alert.maxPerMinute").replace(",", "."))
  const maxPerMinute = Number.isFinite(cap) && cap > 0 ? cap : 8
  const sentRecently = await prisma.alertDispatch.count({
    where: { createdAt: { gte: new Date(Date.now() - 60_000) }, status: { in: ["enviado", "enviando", "falhou"] } },
  })
  const fresh: string[] = []
  for (const signal of signals) {
    if (signal.profitPercent < minimum) continue
    if (sentRecently + fresh.length >= maxPerMinute) break
    const message = alertMessage(signal)
    try {
      await prisma.alertDispatch.create({
        data: { signalKey: signal.key, channel, message, status: "enviando", detail: "", attempts: 1 },
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
      data: {
        status: result.status,
        detail: result.detail,
        nextRetryAt: result.status === "falhou" ? new Date(Date.now() + 30_000) : null,
      },
    })
    fresh.push(signal.key)
  }
  return fresh
}

export async function retryAlerts() {
  const settings = await getSettings()
  const due = await prisma.alertDispatch.findMany({
    where: {
      status: "falhou",
      attempts: { lt: 3 },
      OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: new Date() } }],
    },
    take: 10,
    orderBy: { createdAt: "asc" },
  })
  for (const item of due) {
    if (item.channel !== "discord" && item.channel !== "telegram" && item.channel !== "whatsapp") continue
    let result: { status: "enviado" | "sem_destino" | "falhou"; detail: string }
    try {
      result = await deliverAlert(item.channel, item.message, settings)
    } catch (error) {
      result = { status: "falhou", detail: error instanceof Error ? error.message : "Falha ao enviar." }
    }
    await prisma.alertDispatch.update({
      where: { id: item.id },
      data: {
        status: result.status,
        detail: result.detail,
        attempts: { increment: 1 },
        nextRetryAt: result.status === "falhou" ? new Date(Date.now() + 60_000) : null,
      },
    })
  }
}

export async function sendTestAlert() {
  const settings = await getSettings()
  const channel = settings.get("alert.channel").trim().toLowerCase()
  if (channel !== "discord" && channel !== "telegram" && channel !== "whatsapp") {
    return { ok: false as const, error: "Escolha discord, telegram ou whatsapp." }
  }
  try {
    const result = await deliverAlert(channel, "Fut Surebet: alerta de teste.", settings)
    return { ok: true as const, detail: `${result.status}. ${result.detail}` }
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Falha ao enviar." }
  }
}
