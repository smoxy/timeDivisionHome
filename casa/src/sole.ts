// Tramonto con l'algoritmo semplificato della NOAA (errore di un paio di minuti)
// e finestra del sabato: dal tramonto del venerdì al tramonto del sabato.

import { type Giorno, giornoDi, giornoSettimana, sommaGiorni } from "./tempo.ts";

export type Luogo = { lat: number; lon: number };

const rad = (g: number) => (g * Math.PI) / 180;
const gradi = (r: number) => (r * 180) / Math.PI;

export function tramonto(g: Giorno, luogo: Luogo): Date {
  return orarioDelSole(g, luogo, 1);
}

export function alba(g: Giorno, luogo: Luogo): Date {
  return orarioDelSole(g, luogo, -1);
}

// verso = 1 per il tramonto, -1 per l'alba
function orarioDelSole(g: Giorno, luogo: Luogo, verso: 1 | -1): Date {
  const inizioAnno = Date.UTC(g.anno, 0, 1);
  const n = Math.round((Date.UTC(g.anno, g.mese - 1, g.giorno) - inizioAnno) / 86_400_000) + 1;
  const y = ((2 * Math.PI) / 365) * (n - 1 + (18 - 12) / 24);
  const eqTempo =
    229.18 *
    (0.000075 + 0.001868 * Math.cos(y) - 0.032077 * Math.sin(y) - 0.014615 * Math.cos(2 * y) - 0.040849 * Math.sin(2 * y));
  const decl =
    0.006918 -
    0.399912 * Math.cos(y) +
    0.070257 * Math.sin(y) -
    0.006758 * Math.cos(2 * y) +
    0.000907 * Math.sin(2 * y) -
    0.002697 * Math.cos(3 * y) +
    0.00148 * Math.sin(3 * y);
  const angoloOrario = gradi(
    Math.acos(Math.cos(rad(90.833)) / (Math.cos(rad(luogo.lat)) * Math.cos(decl)) - Math.tan(rad(luogo.lat)) * Math.tan(decl)),
  );
  const minutiUtc = 720 - 4 * (luogo.lon - verso * angoloOrario) - eqTempo;
  return new Date(Date.UTC(g.anno, g.mese - 1, g.giorno) + Math.round(minutiUtc * 60_000));
}

export type FinestraSabato = { venerdi: Giorno; inizio: Date; fine: Date };

export function sabatoDelVenerdi(venerdi: Giorno, luogo: Luogo): FinestraSabato {
  return { venerdi, inizio: tramonto(venerdi, luogo), fine: tramonto(sommaGiorni(venerdi, 1), luogo) };
}

// Il sabato in corso, oppure il prossimo.
export function sabatoCorrenteOProssimo(istante: Date, luogo: Luogo): FinestraSabato {
  const oggi = giornoDi(istante);
  const venerdi = sommaGiorni(oggi, -((giornoSettimana(oggi) - 5 + 7) % 7));
  const f = sabatoDelVenerdi(venerdi, luogo);
  return istante < f.fine ? f : sabatoDelVenerdi(sommaGiorni(venerdi, 7), luogo);
}

export function durante(istante: Date, f: FinestraSabato): boolean {
  return istante >= f.inizio && istante < f.fine;
}

export function nelSabato(istante: Date, luogo: Luogo): FinestraSabato | null {
  const f = sabatoCorrenteOProssimo(istante, luogo);
  return durante(istante, f) ? f : null;
}

// Quando spostare una faccenda che cadrebbe durante il sabato: mezz'ora dopo il tramonto.
export const MARGINE_DOPO_SABATO_MS = 30 * 60_000;

export function dopoIlSabato(f: FinestraSabato): Date {
  return new Date(f.fine.getTime() + MARGINE_DOPO_SABATO_MS);
}
