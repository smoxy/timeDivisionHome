// Lettura di faccende.yaml: il catalogo delle faccende e i dati della casa.

import { readFileSync } from "node:fs";
import { parse } from "yaml";
import type { Luogo } from "./sole.ts";
import { type Giorno, type SiglaGiorno, leggiGiorno, SIGLE_GIORNI } from "./tempo.ts";

export type Cadenza =
  | "settimana"
  | "2 settimane"
  | "mese"
  | "2 mesi"
  | "3 mesi"
  | "4 mesi"
  | "6 mesi"
  | "anno"
  | "evento"
  | "una tantum";

export type Voce = {
  id: string;
  nome: string;
  area: string;
  chi: string; // nome di una persona, "insieme" o "ciascuno"
  ogni: Cadenza;
  giorni: SiglaGiorno[];
  settimana?: "A" | "B";
  occorrenza?: number | "ultima";
  mesi?: "pari" | "dispari" | number[];
  giornoDelMese?: number;
  scadenza?: Giorno;
  ora?: string;
  minuti: number;
  sole: boolean;
  note?: string;
  quando?: string;
  stagione?: string;
  attivaSe?: { tramontoVenerdiDopo?: string; tramontoVenerdiPrima?: string };
  importa: boolean;
};

export type Catalogo = {
  persone: string[];
  luogo: Luogo & { nome: string };
  settimanaA: Giorno; // domenica da cui partono le settimane A
  personaConSede?: string;
  faccende: Voce[];
};

const CADENZE = new Set<string>([
  "settimana",
  "2 settimane",
  "mese",
  "2 mesi",
  "3 mesi",
  "4 mesi",
  "6 mesi",
  "anno",
  "evento",
  "una tantum",
]);

function errore(id: string, msg: string): never {
  throw new Error(`faccende.yaml, voce "${id}": ${msg}`);
}

function comeGiorno(valore: unknown): Giorno {
  // yaml legge AAAA-MM-GG come stringa o come Date a seconda dello schema
  if (valore instanceof Date) return leggiGiorno(valore.toISOString().slice(0, 10));
  return leggiGiorno(String(valore));
}

export function leggiCatalogo(percorso: string): Catalogo {
  const dati = parse(readFileSync(percorso, "utf8"));
  const meta = dati.meta ?? {};
  const persone: string[] = meta.persone ?? [];
  if (persone.length === 0) throw new Error("faccende.yaml: meta.persone è vuoto");

  const orari = meta.orari ?? {};
  const personaConSede = persone.find((p) => Array.isArray(orari[p]?.sede));

  const faccende: Voce[] = (dati.faccende ?? []).map((f: Record<string, any>): Voce => {
    const id = String(f.id ?? "");
    if (!id) throw new Error("faccende.yaml: una voce non ha id");
    if (!CADENZE.has(f.ogni)) errore(id, `cadenza "${f.ogni}" sconosciuta`);
    const chi = String(f.chi);
    if (chi !== "insieme" && chi !== "ciascuno" && !persone.includes(chi)) errore(id, `"${chi}" non è in meta.persone`);
    const giorni: SiglaGiorno[] = f.giorni ?? [];
    for (const g of giorni) if (!SIGLE_GIORNI.includes(g)) errore(id, `giorno "${g}" sconosciuto`);
    const occorrenza = f.occorrenza === undefined ? undefined : f.occorrenza === "ultima" ? "ultima" : Number(f.occorrenza);
    const a = f.attiva_se;
    return {
      id,
      nome: String(f.nome),
      area: String(f.area ?? ""),
      chi,
      ogni: f.ogni,
      giorni,
      settimana: f.settimana,
      occorrenza,
      mesi: f.mesi,
      giornoDelMese: f.giorno_del_mese,
      scadenza: f.scadenza === undefined ? undefined : comeGiorno(f.scadenza),
      ora: f.ora,
      minuti: Number(f.minuti ?? 0),
      sole: Boolean(f.sole),
      note: f.note?.trim(),
      quando: f.quando,
      stagione: f.stagione,
      attivaSe: a ? { tramontoVenerdiDopo: a.tramonto_venerdi_dopo, tramontoVenerdiPrima: a.tramonto_venerdi_prima } : undefined,
      importa: f.importa !== false,
    };
  });

  return {
    persone,
    luogo: { nome: meta.luogo?.nome ?? "", lat: Number(meta.luogo?.lat), lon: Number(meta.luogo?.lon) },
    settimanaA: comeGiorno(meta.settimana_A_inizia),
    personaConSede,
    faccende,
  };
}

// Persone a cui tocca una voce: "ciascuno" vale per tutti, "insieme" resta una sola voce condivisa.
export function destinatari(voce: Voce, cat: Catalogo): string[] {
  return voce.chi === "ciascuno" ? cat.persone : [voce.chi];
}
