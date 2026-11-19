// Bot Telegram: un messaggio a una chat e l'elenco delle chat che hanno scritto al bot.
// Nessuna dipendenza: è l'API HTTP dei bot. Il token non compare mai negli errori.

import { config } from "./config.ts";

async function chiama(metodo: string, corpo: Record<string, unknown> = {}) {
  const token = config.telegram.token;
  if (!token) throw new Error("Manca TELEGRAM_BOT_TOKEN");
  const r = await fetch(`https://api.telegram.org/bot${token}/${metodo}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(15_000),
  });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; result?: unknown; description?: string };
  if (!j.ok) throw new Error(`Telegram ${metodo}: ${j.description ?? r.status}`);
  return j.result;
}

export async function inviaMessaggio(chatId: string, testo: string): Promise<void> {
  await chiama("sendMessage", { chat_id: chatId, text: testo.slice(0, 4000), disable_web_page_preview: true });
}

export type ChatNota = { id: number; nome: string; username?: string };

// Le chat dei messaggi ricevuti dal bot di recente: serve a trovare il chat id di chi ha premuto Start.
export async function ultimiChat(): Promise<ChatNota[]> {
  const aggiornamenti = (await chiama("getUpdates", { timeout: 0, allowed_updates: ["message"] })) as {
    message?: { chat: { id: number; first_name?: string; last_name?: string; title?: string; username?: string } };
  }[];
  const viste = new Map<number, ChatNota>();
  for (const a of aggiornamenti) {
    const c = a.message?.chat;
    if (!c) continue;
    viste.set(c.id, { id: c.id, nome: c.title ?? [c.first_name, c.last_name].filter(Boolean).join(" "), username: c.username });
  }
  return [...viste.values()];
}
