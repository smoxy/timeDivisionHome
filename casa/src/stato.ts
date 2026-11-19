// Piccolo stato persistente di Casa: giorni in sede per settimana, giorni saltati di una voce,
// riassegnazioni temporanee decise dall'assistente e registro delle sue modifiche.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { SiglaGiorno } from "./tempo.ts";

export type Riassegnazione = { choreId: number; nome: string; daUtente: number | null; aUtente: number; scadenza: string };
export type Modifica = { quando: string; settimana: string; choreId: number; nome: string; azione: string; motivo: string; applicata: boolean };

export type Stato = {
  // domenica ISO -> giorni in sede di quella settimana, solo quando sono diversi dai predefiniti
  sede: Record<string, SiglaGiorno[]>;
  // id voce -> giorni (ISO) in cui quella voce non c'è, per tutti (palestra annullata, ospiti, ...)
  saltate: Record<string, string[]>;
  riassegnazioni: Riassegnazione[];
  registro: Modifica[];
  // promemoria già gestiti: "AAAA-MM-GG|persona|slot" -> quando sono partiti (o perché no: sabato, vuoto)
  promemoria: Record<string, string>;
};

export function leggiStato(percorso: string): Stato {
  try {
    const s = JSON.parse(readFileSync(percorso, "utf8"));
    return { sede: s.sede ?? {}, saltate: s.saltate ?? {}, riassegnazioni: s.riassegnazioni ?? [], registro: s.registro ?? [], promemoria: s.promemoria ?? {} };
  } catch {
    return { sede: {}, saltate: {}, riassegnazioni: [], registro: [], promemoria: {} };
  }
}

export function scriviStato(percorso: string, stato: Stato) {
  mkdirSync(dirname(percorso), { recursive: true });
  writeFileSync(percorso, JSON.stringify(stato, null, 2));
}
