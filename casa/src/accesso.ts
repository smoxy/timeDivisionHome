// Accesso con password per persona e cookie di sessione firmato.

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const DURATA_SESSIONE_MS = 60 * 24 * 60 * 60_000; // 60 giorni

export function hashPassword(password: string): string {
  const sale = randomBytes(16);
  const hash = scryptSync(password, sale, 32);
  return `scrypt$${sale.toString("hex")}$${hash.toString("hex")}`;
}

export function verificaPassword(password: string, salvato: string | undefined): boolean {
  if (!salvato) return false;
  const [tipo, saleHex, hashHex] = salvato.split("$");
  if (tipo !== "scrypt" || !saleHex || !hashHex) return false;
  const atteso = Buffer.from(hashHex, "hex");
  const calcolato = scryptSync(password, Buffer.from(saleHex, "hex"), atteso.length);
  return timingSafeEqual(atteso, calcolato);
}

function firma(testo: string, segreto: string): string {
  return createHmac("sha256", segreto).update(testo).digest("base64url");
}

export function creaSessione(persona: string, segreto: string, adesso = Date.now()): string {
  const corpo = `${encodeURIComponent(persona)}.${adesso + DURATA_SESSIONE_MS}`;
  return `${corpo}.${firma(corpo, segreto)}`;
}

export function leggiSessione(valore: string | undefined, segreto: string, adesso = Date.now()): string | null {
  if (!valore) return null;
  const i = valore.lastIndexOf(".");
  if (i < 0) return null;
  const corpo = valore.slice(0, i);
  const atteso = Buffer.from(firma(corpo, segreto));
  const ricevuto = Buffer.from(valore.slice(i + 1));
  if (atteso.length !== ricevuto.length || !timingSafeEqual(atteso, ricevuto)) return null;
  const [persona, scadenza] = corpo.split(".");
  if (Number(scadenza) < adesso) return null;
  return decodeURIComponent(persona);
}

export const DURATA_SESSIONE_S = DURATA_SESSIONE_MS / 1000;

// Limite ai tentativi di accesso: 5 al minuto per indirizzo.
const tentativi = new Map<string, number[]>();

export function troppiTentativi(ip: string, adesso = Date.now()): boolean {
  const recenti = (tentativi.get(ip) ?? []).filter((t) => adesso - t < 60_000);
  recenti.push(adesso);
  tentativi.set(ip, recenti);
  return recenti.length > 5;
}
