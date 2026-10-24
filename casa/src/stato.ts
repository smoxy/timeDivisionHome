// Piccolo stato persistente di Casa: gli scambi dei giorni in sede.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type Scambio = { persona: string; inSede: string; daRemoto: string; creato: string };
export type Stato = { scambi: Scambio[] };

export function leggiStato(percorso: string): Stato {
  try {
    return { scambi: [], ...JSON.parse(readFileSync(percorso, "utf8")) };
  } catch {
    return { scambi: [] };
  }
}

export function scriviStato(percorso: string, stato: Stato) {
  mkdirSync(dirname(percorso), { recursive: true });
  writeFileSync(percorso, JSON.stringify(stato, null, 2));
}
