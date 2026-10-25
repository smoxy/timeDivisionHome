// Quando cade una faccenda: espande le regole di faccende.yaml in date concrete,
// applicando stagioni, mesi pari e dispari e lo spostamento fuori dal sabato.

import { type Catalogo, destinatari, type Voce } from "./catalogo.ts";
import { dopoIlSabato, nelSabato, tramonto } from "./sole.ts";
import {
  confronta,
  domenicaDi,
  type Giorno,
  giorniTra,
  istanteLocale,
  leggiOra,
  oraLocale,
  sigla,
  sommaGiorni,
  ultimoDelMese,
} from "./tempo.ts";

export type Occorrenza = {
  voce: Voce;
  chi: string;
  previsto: Date; // quando dice la regola
  quando: Date; // dopo l'eventuale spostamento fuori dal sabato
  spostataDalSabato: boolean;
};

export function meseAmmesso(mesi: Voce["mesi"], mese: number): boolean {
  if (mesi === undefined) return true;
  if (mesi === "pari") return mese % 2 === 0;
  if (mesi === "dispari") return mese % 2 === 1;
  return mesi.includes(mese);
}

function occorrenzaNelMese(g: Giorno): number {
  return Math.floor((g.giorno - 1) / 7) + 1;
}

function eUltimaNelMese(g: Giorno): boolean {
  return g.giorno + 7 > ultimoDelMese(g);
}

export function settimanaAB(g: Giorno, settimanaA: Giorno): "A" | "B" {
  const settimane = Math.floor(giorniTra(settimanaA, domenicaDi(g)) / 7);
  return ((settimane % 2) + 2) % 2 === 0 ? "A" : "B";
}

// La regola della voce cade in questo giorno? (Senza stagioni né sabato.)
export function cadeIl(voce: Voce, g: Giorno, cat: Catalogo): boolean {
  if (voce.scadenza) return confronta(voce.scadenza, g) === 0;
  if (voce.ogni === "evento" || voce.ogni === "una tantum") return false;
  if (voce.giorni.length > 0 && !voce.giorni.includes(sigla(g))) {
    // "dentro" segue i giorni in sede anche quando cambiano: i giorni scritti sono solo quelli predefiniti
    if (voce.sede !== "dentro") return false;
  }
  if (voce.sede) {
    const inSede = cat.sedeDellaSettimana(domenicaDi(g)).includes(sigla(g));
    if ((voce.sede === "dentro") !== inSede) return false;
    if (voce.sede === "dentro" && voce.ogni === "settimana") return true;
  }
  switch (voce.ogni) {
    case "settimana":
      return voce.giorni.length > 0;
    case "2 settimane":
      return voce.giorni.length > 0 && settimanaAB(g, cat.settimanaA) === (voce.settimana ?? "A");
    case "mese":
    case "2 mesi":
    case "3 mesi":
    case "4 mesi": {
      if (voce.occorrenza === undefined || voce.giorni.length === 0) return false;
      const ok = voce.occorrenza === "ultima" ? eUltimaNelMese(g) : occorrenzaNelMese(g) === voce.occorrenza;
      return ok && meseAmmesso(voce.mesi, g.mese);
    }
    case "6 mesi":
    case "anno":
      return voce.giornoDelMese === g.giorno && meseAmmesso(voce.mesi, g.mese);
  }
}

// La stagione della voce è attiva nella settimana di questo giorno?
export function attivaIl(voce: Voce, g: Giorno, cat: Catalogo): boolean {
  if (!voce.attivaSe) return true;
  const venerdi = sommaGiorni(domenicaDi(g), 5);
  const t = oraLocale(tramonto(venerdi, cat.luogo));
  const { tramontoVenerdiDopo: dopo, tramontoVenerdiPrima: prima } = voce.attivaSe;
  if (dopo && !(t >= dopo.padStart(5, "0"))) return false;
  if (prima && !(t < prima.padStart(5, "0"))) return false;
  return true;
}

function orarioDi(voce: Voce): { ore: number; minuti: number } {
  return voce.ora ? leggiOra(voce.ora) : { ore: 9, minuti: 0 };
}

export function occorrenzeDelGiorno(voce: Voce, g: Giorno, cat: Catalogo): Occorrenza[] {
  if (!voce.importa || !cadeIl(voce, g, cat) || !attivaIl(voce, g, cat)) return [];
  const { ore, minuti } = orarioDi(voce);
  const previsto = istanteLocale(g, ore, minuti);
  const sabato = nelSabato(previsto, cat.luogo);
  const quando = sabato ? dopoIlSabato(sabato) : previsto;
  return destinatari(voce, cat).map((chi) => ({ voce, chi, previsto, quando, spostataDalSabato: sabato !== null }));
}

export function occorrenze(cat: Catalogo, da: Giorno, a: Giorno): Occorrenza[] {
  const tutte: Occorrenza[] = [];
  for (let g = da; confronta(g, a) <= 0; g = sommaGiorni(g, 1)) {
    for (const voce of cat.faccende) tutte.push(...occorrenzeDelGiorno(voce, g, cat));
  }
  return tutte.sort((x, y) => x.quando.getTime() - y.quando.getTime());
}

// Prima occorrenza della voce strettamente dopo un istante (entro due anni).
export function prossima(voce: Voce, dopo: Date, cat: Catalogo, ignoraStagione = false): Occorrenza | null {
  let g = sommaGiorni({ anno: dopo.getUTCFullYear(), mese: dopo.getUTCMonth() + 1, giorno: dopo.getUTCDate() }, -1);
  for (let i = 0; i < 800; i++, g = sommaGiorni(g, 1)) {
    if (!voce.importa || !cadeIl(voce, g, cat)) continue;
    if (!ignoraStagione && !attivaIl(voce, g, cat)) continue;
    const { ore, minuti } = orarioDi(voce);
    const previsto = istanteLocale(g, ore, minuti);
    if (previsto <= dopo) continue;
    const sabato = nelSabato(previsto, cat.luogo);
    const quando = sabato ? dopoIlSabato(sabato) : previsto;
    return { voce, chi: voce.chi, previsto, quando, spostataDalSabato: sabato !== null };
  }
  return null;
}
