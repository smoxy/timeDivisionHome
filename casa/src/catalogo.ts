// Lettura di faccende.yaml: il catalogo delle faccende e i dati della casa.

import { readFileSync } from "node:fs";
import { parse } from "yaml";
import type { Luogo } from "./sole.ts";
import { confronta, type Giorno, type SiglaGiorno, leggiGiorno, leggiOra, SIGLE_GIORNI } from "./tempo.ts";

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
  concetto: string; // voci con lo stesso concetto sono la stessa cosa: se ne mostra una sola
  sede?: "dentro" | "fuori" | "vigilia"; // legata ai giorni in sede di personaConSede (vigilia: la sera prima)
  macchine?: Record<string, string>; // macchine ad alto consumo usate -> ora di partenza HH:MM
};

export type Catalogo = {
  persone: string[];
  luogo: Luogo & { nome: string };
  settimanaA: Giorno; // domenica da cui partono le settimane A
  personaConSede?: string;
  sedePredefinita: SiglaGiorno[];
  margineDomenicaMinuti: number; // la domenica le scadenze slittano di tanto, salvo gli appuntamenti
  fuoriCasaInSede: [string, string]; // fascia in cui chi è in sede non è a casa
  lavoroRemoto: string[]; // fasce "HH:MM-HH:MM" in cui chi ha i giorni in sede lavora, nei feriali da remoto
  // Impegni fissi per persona, come in meta.orari: per giorno "HH:MM-HH:MM" (universita, online, ...)
  impegni: Record<string, Partial<Record<SiglaGiorno, string[]>>>;
  // Giorni in sede della settimana che comincia in quella domenica (predefiniti, salvo modifiche)
  sedeDellaSettimana: (domenica: Giorno) => SiglaGiorno[];
  // Quel giorno la voce è stata saltata per tutti (da stato.json)
  saltataIl: (voceId: string, giorno: Giorno) => boolean;
  // Macchine ad alto consumo (lavatrice, forno, ...) che devono aver finito entro un'ora, finché dura il vincolo
  macchine: { entro: string; fino?: Giorno; durata: Record<string, number> } | null;
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
      macchine: macchineDa(id, f.macchine, meta.macchine),
      concetto: String(f.concetto ?? id),
      sede: f.sede === "dentro" || f.sede === "fuori" || f.sede === "vigilia" ? f.sede : f.sede === undefined ? undefined : errore(id, `sede "${f.sede}" sconosciuta`),
    };
  });

  const sedePredefinita: SiglaGiorno[] = personaConSede ? orari[personaConSede].sede : [];
  return {
    persone,
    sedePredefinita,
    margineDomenicaMinuti: Number(meta.margine_domenica_minuti ?? 0),
    fuoriCasaInSede: personaConSede ? (orari[personaConSede].fuori_casa_in_sede ?? ["06:00", "19:45"]) : ["06:00", "19:45"],
    lavoroRemoto: personaConSede ? (orari[personaConSede].lavoro_remoto ?? []) : [],
    macchine: meta.macchine
      ? {
          entro: String(meta.macchine.entro),
          fino: meta.macchine.fino_a === undefined ? undefined : comeGiorno(meta.macchine.fino_a),
          durata: Object.fromEntries(Object.entries(meta.macchine.durata_minuti ?? {}).map(([k, v]) => [k, Number(v)])),
        }
      : null,
    sedeDellaSettimana: () => sedePredefinita,
    saltataIl: () => false,
    impegni: impegniDa(orari, persone),
    luogo: { nome: meta.luogo?.nome ?? "", lat: Number(meta.luogo?.lat), lon: Number(meta.luogo?.lon) },
    settimanaA: comeGiorno(meta.settimana_A_inizia),
    personaConSede,
    faccende,
  };
}

function macchineDa(id: string, valore: unknown, regola: any): Record<string, string> | undefined {
  if (valore === undefined) return undefined;
  if (typeof valore !== "object" || valore === null || Array.isArray(valore)) errore(id, "macchine deve essere macchina: HH:MM");
  const macchine: Record<string, string> = {};
  for (const [nome, ora] of Object.entries(valore)) {
    if (regola && !(nome in (regola.durata_minuti ?? {}))) errore(id, `macchina "${nome}" senza durata in meta.macchine`);
    leggiOra(String(ora));
    macchine[nome] = String(ora);
  }
  return macchine;
}

// Le macchine di una voce che, partendo alle ore previste (spostate di `spostamentoMinuti`), finirebbero
// dopo il limite del fotovoltaico. Vuoto se il vincolo non c'è o è scaduto.
export function macchineOltre(voce: Voce, g: Giorno, cat: Catalogo, spostamentoMinuti = 0): string[] {
  const m = cat.macchine;
  if (!m || !voce.macchine || (m.fino && confronta(g, m.fino) > 0)) return [];
  const minuti = (t: string) => {
    const { ore, minuti: mm } = leggiOra(t);
    return ore * 60 + mm;
  };
  const come = (n: number) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
  const fuori: string[] = [];
  for (const [nome, ora] of Object.entries(voce.macchine)) {
    const inizio = minuti(ora) + spostamentoMinuti;
    const fine = inizio + (m.durata[nome] ?? 0);
    if (fine > minuti(m.entro)) fuori.push(`${nome} da ${come(inizio)} finisce alle ${come(fine)}, dopo le ${m.entro}`);
  }
  return fuori;
}

function impegniDa(orari: Record<string, any>, persone: string[]) {
  const impegni: Catalogo["impegni"] = {};
  for (const p of persone) {
    const perGiorno: Partial<Record<SiglaGiorno, string[]>> = {};
    for (const [chiave, valore] of Object.entries(orari[p] ?? {})) {
      if (chiave === "sede" || !valore || typeof valore !== "object" || Array.isArray(valore)) continue;
      for (const [g, fascia] of Object.entries(valore as Record<string, string>)) {
        if (SIGLE_GIORNI.includes(g as SiglaGiorno) && /^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/.test(String(fascia))) {
          (perGiorno[g as SiglaGiorno] ??= []).push(String(fascia));
        }
      }
    }
    impegni[p] = perGiorno;
  }
  return impegni;
}

// Persone a cui tocca una voce: "ciascuno" vale per tutti, "insieme" resta una sola voce condivisa.
export function destinatari(voce: Voce, cat: Catalogo): string[] {
  return voce.chi === "ciascuno" ? cat.persone : [voce.chi];
}
