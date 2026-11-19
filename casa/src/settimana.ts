// La settimana come la vede Casa: le occorrenze del catalogo con gli spostamenti per i giorni in sede.
// La usano le API della UI, il carico per l'assistente e i promemoria.

import { type Occorrenza, occorrenze } from "./calendario.ts";
import type { Catalogo } from "./catalogo.ts";
import type { CaricoGiorni } from "./automazioni.ts";
import { abbinaGiorni, fuoriCasa, giaNelGiorno } from "./lavori.ts";
import { type Giorno, giornoDi, isoGiorno, istanteLocale, leggiGiorno, oraLocale, parti, SIGLE_GIORNI, sigla, sommaGiorni } from "./tempo.ts";

export type VoceDellaSettimana = {
  id: string;
  nome: string;
  chi: string;
  giorno: string;
  ora: string;
  minuti: number;
  area: string;
  sole: boolean;
  spostataDalSabato: boolean;
  spostataPerSede: boolean;
  concetto: string;
};

// Una faccenda della persona con i giorni in sede (o da fare insieme) che cade mentre è fuori casa
// in un nuovo giorno in sede: nella settimana si mostra nel giorno abbinato, dove l'ha spostata Casa.
export function giornoDopoCambioSede(cat: Catalogo, o: Occorrenza, domenica: Giorno): Giorno | null {
  if (o.voce.sede || !cat.personaConSede || (o.chi !== cat.personaConSede && o.chi !== "insieme")) return null;
  if (!fuoriCasa(o.quando, cat)) return null;
  const coppia = abbinaGiorni(cat.sedePredefinita, cat.sedeDellaSettimana(domenica)).find((k) => k.prende === sigla(giornoDi(o.quando)));
  return coppia ? sommaGiorni(domenica, SIGLE_GIORNI.indexOf(coppia.lascia)) : null;
}

export function settimanaDi(cat: Catalogo, da: Giorno): { voci: VoceDellaSettimana[]; minuti: Record<string, number> } {
  const a = sommaGiorni(da, 6);
  const voci = occorrenze(cat, da, a).flatMap((o) => {
    let quando = o.quando;
    const nuovoGiorno = giornoDopoCambioSede(cat, o, da);
    // Nel giorno liberato la stessa cosa c'è già: questa volta la faccenda si salta
    if (nuovoGiorno && giaNelGiorno(o.voce, nuovoGiorno, cat)) return [];
    if (nuovoGiorno) {
      const { ore, minuti } = parti(quando);
      quando = istanteLocale(nuovoGiorno, ore, minuti);
    }
    return [{
      id: o.voce.id,
      nome: o.voce.nome,
      chi: o.chi,
      giorno: isoGiorno(giornoDi(quando)),
      ora: oraLocale(quando),
      minuti: o.voce.minuti,
      area: o.voce.area,
      sole: o.voce.sole,
      spostataDalSabato: o.spostataDalSabato,
      spostataPerSede: Boolean(nuovoGiorno),
      concetto: o.voce.concetto,
    }];
  });
  const minuti: Record<string, number> = {};
  for (const v of voci) {
    const chi = v.chi === "insieme" ? cat.persone : [v.chi];
    for (const p of chi) minuti[p] = (minuti[p] ?? 0) + v.minuti;
  }
  return { voci, minuti };
}

const NON_FACCENDE = new Set(["palestra", "salute"]);

export function caricoPerGiorno(cat: Catalogo, da: Giorno): CaricoGiorni {
  const carico: CaricoGiorni = {};
  for (const v of settimanaDi(cat, da).voci) {
    // Palestra e visite non sono faccende: spostarle cambia il giorno a entrambi, non il carico
    if (NON_FACCENDE.has(v.area)) continue;
    const g = sigla(leggiGiorno(v.giorno));
    for (const p of v.chi === "insieme" ? cat.persone : [v.chi]) (carico[p] ??= {})[g] = (carico[p][g] ?? 0) + v.minuti;
  }
  return carico;
}
