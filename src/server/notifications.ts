import { formatBRL, whatsAppNumber } from "@/lib/format";
import { config } from "./config";
import { prisma } from "./db";
import { fetchJson } from "./http";

export async function notifyAdmin(title: string, body: string, level: "info" | "critical" = "critical") {
  await prisma.adminAlert.create({ data: { level, title, body } });
  if (!config.telegramToken || !config.telegramChatId) {
    await logNotification({
      channel: "telegram",
      target: "admin",
      body: `${title}\n${body}`,
      status: "SKIPPED",
      error: "TELEGRAM_BOT_TOKEN ou TELEGRAM_CHAT_ID ausente",
    });
    return;
  }
  try {
    await fetchJson(`https://api.telegram.org/bot${config.telegramToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: config.telegramChatId,
        text: `<b>${escapeHtml(title)}</b>\n${escapeHtml(body)}`,
        parse_mode: "HTML",
      }),
    });
    await logNotification({ channel: "telegram", target: config.telegramChatId, body: `${title}\n${body}`, status: "SENT" });
  } catch (error) {
    await logNotification({
      channel: "telegram",
      target: config.telegramChatId,
      body: `${title}\n${body}`,
      status: "FAILED",
      error: error instanceof Error ? error.message : "falha",
    });
  }
}

export function recoveryText(input: { name: string; code: string; amountCents: number; pix: string }) {
  const template = process.env.RECOVERY_MESSAGE_TEMPLATE;
  if (template) {
    return template
      .replaceAll("{nome}", input.name)
      .replaceAll("{codigo}", input.code)
      .replaceAll("{valor}", formatBRL(input.amountCents))
      .replaceAll("{pix}", input.pix);
  }
  return [
    `Olá, ${input.name}. Aqui é a Novos Horizontes.`,
    "",
    `O pedido ${input.code} (${formatBRL(input.amountCents)}) ainda está com o PIX em aberto. Se quiser seguir com a compra, use o copia-e-cola abaixo. Se já pagou ou desistiu, pode ignorar esta mensagem.`,
    "",
    input.pix,
  ].join("\n");
}

export async function sendWhatsAppText(phone: string | null | undefined, text: string, orderId?: string | null) {
  if (!phone) {
    await logNotification({ channel: "whatsapp", target: "sem-telefone", body: text, status: "SKIPPED", error: "Telefone ausente", orderId });
    return;
  }
  const number = whatsAppNumber(phone);
  if (!config.evolutionUrl || !config.evolutionKey) {
    await logNotification({
      channel: "whatsapp",
      target: number,
      body: text,
      status: "SKIPPED",
      error: "Evolution API não configurada. A mensagem ficou registrada para revisão.",
      orderId,
    });
    return;
  }
  try {
    await fetchJson(`${trimSlash(config.evolutionUrl)}/message/sendText/${config.evolutionInstance}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: config.evolutionKey },
      body: JSON.stringify({ number, text }),
    });
    await logNotification({ channel: "whatsapp", target: number, body: text, status: "SENT", orderId });
  } catch (error) {
    await logNotification({
      channel: "whatsapp",
      target: number,
      body: text,
      status: "FAILED",
      error: error instanceof Error ? error.message : "falha",
      orderId,
    });
    throw error;
  }
}

export async function sendWhatsAppAudio(phone: string, orderId?: string | null) {
  if (!config.recoveryAudioUrl) return;
  const number = whatsAppNumber(phone);
  const note = `Áudio de lembrete (${config.recoveryAudioPtt ? "PTT" : "arquivo"}): ${config.recoveryAudioUrl}`;
  if (!config.evolutionUrl || !config.evolutionKey) {
    await logNotification({
      channel: "whatsapp-audio",
      target: number,
      body: note,
      status: "SKIPPED",
      error: "Evolution API não configurada",
      orderId,
    });
    return;
  }
  await fetchJson(`${trimSlash(config.evolutionUrl)}/message/sendWhatsAppAudio/${config.evolutionInstance}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: config.evolutionKey },
    body: JSON.stringify({ number, audio: config.recoveryAudioUrl, ptt: config.recoveryAudioPtt }),
  });
  await logNotification({ channel: "whatsapp-audio", target: number, body: note, status: "SENT", orderId });
}

async function logNotification(input: {
  channel: string;
  target: string;
  body: string;
  status: string;
  error?: string;
  orderId?: string | null;
}) {
  await prisma.notificationLog.create({
    data: {
      channel: input.channel,
      target: input.target,
      body: input.body,
      status: input.status,
      error: input.error,
      orderId: input.orderId ?? undefined,
    },
  });
}

function trimSlash(value: string) {
  return value.replace(/\/$/, "");
}

function escapeHtml(value: string) {
  return value.replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char] ?? char);
}
