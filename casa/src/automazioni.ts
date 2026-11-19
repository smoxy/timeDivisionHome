// Assistente: quando cambiano i giorni in sede Casa avvisa n8n, che chiede a un LLM qualche
// spostamento per riequilibrare il carico. Le proposte tornano qui e Casa le controlla una per una
// prima di applicarle: l'LLM propone, Casa decide.

import { timingSafeEqual } from "node:crypto";
import { type Catalogo, macchineOltre } from "./catalogo.ts";
import { config } from "./config.ts";
import { type Donetick, type DonetickChore, leggiMarcatore, type Membro } from "./donetick.ts";
import { fuoriCasa } from "./lavori.ts";
import { nelSabato } from "./sole.ts";
import { leggiStato, scriviStato } from "./stato.ts";
import {
  confronta,
  domenicaDi,
  type Giorno,
  giornoDi,
  isoGiorno,
  istanteLocale,
  oraLocale,
  parti,
  SIGLE_GIORNI,
  sigla,
  type SiglaGiorno,
  sommaGiorni,
} from "./tempo.ts";
import { utenteDi } from "./servizi.ts";

export const MASSIMO_PROPOSTE = 5;

export type Proposta = { choreId: number; chi?: string; quando?: string; motivo?: string };

export function tokenValido(ricevuto: string | undefined): boolean {
  const atteso = config.n8nToken;
  if (!atteso || !ricevuto) return false;
  const a = Buffer.from(atteso);
  const b = Buffer.from(ricevuto);
  return a.length === b.length && timingSafeEqual(a, b);
}

function personaDi(c: DonetickChore, cat: Catalogo, membri: Membro[]): string {
  if (c.assignedTo == null) return "insieme";
  return cat.persone.find((p) => utenteDi(p, membri)?.userId === c.assignedTo) ?? "?";
}

// Faccende della settimana ancora da fare, come le vede Donetick (una per faccenda: la prossima)
function daFare(faccende: DonetickChore[], domenica: Giorno, adesso: Date) {
  const inizio = istanteLocale(domenica);
  const fine = istanteLocale(sommaGiorni(domenica, 7));
  return faccende.filter((c) => {
    if (!c.isActive || !c.nextDueDate) return false;
    const t = new Date(c.nextDueDate);
    return t >= inizio && t < fine && t > adesso;
  });
}

// Minuti di faccende per persona e per giorno della settimana ("insieme" conta per entrambi; palestra e visite no)
export type CaricoGiorni = Record<string, Partial<Record<SiglaGiorno, number>>>;

export type GiornoPieno = {
  giorno: SiglaGiorno;
  persona: string;
  minuti: number;
  diSolito: number;
  altra: string;
  minutiAltra: number;
  daPassare: number;
};

const SOGLIA_MINUTI = 15;
const FERIALI: SiglaGiorno[] = ["lun", "mar", "mer", "gio", "ven"];

// I giorni in cui, dopo il cambio, qualcuno ha molto più del solito e più dell'altra persona.
// daPassare: quanti minuti converrebbe dare all'altra, senza invertire il carico.
export function giorniPiuPieni(cat: Catalogo, adesso: CaricoGiorni, diSolito: CaricoGiorni): GiornoPieno[] {
  const pieni: GiornoPieno[] = [];
  for (const giorno of SIGLE_GIORNI) {
    for (const persona of cat.persone) {
      const minuti = adesso[persona]?.[giorno] ?? 0;
      const solito = diSolito[persona]?.[giorno] ?? 0;
      const [altra, minutiAltra] = cat.persone
        .filter((x) => x !== persona)
        .map((x) => [x, adesso[x]?.[giorno] ?? 0] as const)
        .sort((a, b) => a[1] - b[1])[0] ?? ["", 0];
      if (!altra || minuti - solito < SOGLIA_MINUTI || minuti <= minutiAltra) continue;
      const daPassare = Math.min(minuti - solito, Math.floor((minuti - minutiAltra) / 2));
      if (daPassare >= 10) pieni.push({ giorno, persona, minuti, diSolito: solito, altra, minutiAltra, daPassare });
    }
  }
  return pieni;
}

export async function inviaEvento(
  client: Donetick,
  cat: Catalogo,
  membri: Membro[],
  domenica: Giorno,
  carico: { adesso: CaricoGiorni; diSolito: CaricoGiorni },
  adesso = new Date(),
  prova = false, // l'assistente risponde, ma Casa valuta senza applicare
): Promise<string> {
  if (!config.n8nWebhook || !config.n8nToken) return "assistente non configurato";
  const pieni = giorniPiuPieni(cat, carico.adesso, carico.diSolito);
  if (pieni.length === 0) return "niente da ribilanciare";
  // Candidati: le faccende di chi ha il giorno pieno che l'altra persona può fare alla stessa ora.
  // Casa decide cosa è possibile, l'LLM sceglie tra queste.
  const voci = new Map(cat.faccende.map((v) => [v.id, v]));
  const candidati = daFare(await client.faccende(false), domenica, adesso).flatMap((c) => {
    const voce = voci.get(leggiMarcatore(c)?.id ?? "");
    const t = new Date(c.nextDueDate!);
    const pieno = pieni.find((p) => p.giorno === sigla(giornoDi(t)) && p.persona === personaDi(c, cat, membri));
    // Mai le faccende personali né quelle che da sole supererebbero di molto i minuti da passare
    if (!voce || voce.sede || voce.chi === "ciascuno" || !voce.minuti || !pieno) return [];
    if (voce.minuti > pieno.daPassare + 5 || impedimento(pieno.altra, t, cat)) return [];
    return [{ choreId: c.id, nome: voce.nome, giorno: pieno.giorno, ora: oraLocale(t), minuti: voce.minuti, da: pieno.persona, a: pieno.altra }];
  });
  if (candidati.length === 0) return "niente da ribilanciare: nessuna faccenda si può passare";
  const corpo = {
    settimana: isoGiorno(domenica),
    prova,
    giorniInSede: cat.sedeDellaSettimana(domenica),
    giorniPiuPieni: pieni,
    candidati,
    massimoProposte: MASSIMO_PROPOSTE,
  };
  const r = await fetch(config.n8nWebhook, {
    method: "POST",
    headers: { "content-type": "application/json", "x-casa-token": config.n8nToken },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(10_000),
  });
  return `n8n ha risposto ${r.status} (${candidati.length} candidati)`;
}

function minutiDelGiorno(t: Date): number {
  const { ore, minuti } = parti(t);
  return ore * 60 + minuti;
}

function dentroFascia(t: Date, fascia: string): boolean {
  const [da, a] = fascia.split("-").map((x) => x.padStart(5, "0"));
  const ora = oraLocale(t);
  return ora >= da && ora < a;
}

// Perché una persona non può fare una faccenda in quel momento; null se può
export function impedimento(persona: string, t: Date, cat: Catalogo): string | null {
  if (nelSabato(t, cat.luogo)) return "cade durante il sabato";
  const g = giornoDi(t);
  if (persona === cat.personaConSede && cat.sedeDellaSettimana(domenicaDi(g)).includes(sigla(g)) && fuoriCasa(t, cat)) {
    return `${persona} è in sede e fuori casa`;
  }
  for (const fascia of cat.impegni[persona]?.[sigla(g)] ?? []) {
    if (dentroFascia(t, fascia)) return `${persona} ha un impegno ${fascia}`;
  }
  if (persona === cat.personaConSede && FERIALI.includes(sigla(g)) && !cat.sedeDellaSettimana(domenicaDi(g)).includes(sigla(g))) {
    for (const fascia of cat.lavoroRemoto) {
      if (dentroFascia(t, fascia)) return `${persona} lavora da remoto ${fascia}`;
    }
  }
  return null;
}

export async function applicaProposte(
  client: Donetick,
  cat: Catalogo,
  membri: Membro[],
  settimana: Giorno,
  proposte: Proposta[],
  statoPercorso: string,
  adesso = new Date(),
  prova = false, // valuta e basta: niente spostamenti, niente registro
) {
  const stato = leggiStato(statoPercorso);
  const voci = new Map(cat.faccende.map((v) => [v.id, v]));
  const faccende = await client.faccende(false);
  const dellaSettimana = new Map(daFare(faccende, settimana, adesso).map((c) => [c.id, c]));
  const esiti: { choreId: number; applicata: boolean; azione: string; motivo: string }[] = [];

  for (const [i, p] of proposte.entries()) {
    const registra = (applicata: boolean, azione: string, nome = "") => {
      const voce = { choreId: p.choreId, applicata, azione, motivo: p.motivo ?? "" };
      esiti.push(voce);
      if (!prova) stato.registro.push({ quando: adesso.toISOString(), settimana: isoGiorno(settimana), nome, ...voce });
    };
    if (i >= MASSIMO_PROPOSTE) {
      registra(false, `scartata: oltre il limite di ${MASSIMO_PROPOSTE} proposte`);
      continue;
    }
    const c = dellaSettimana.get(Number(p.choreId));
    if (!c) {
      registra(false, "scartata: faccenda non trovata tra quelle da fare questa settimana");
      continue;
    }
    const voce = voci.get(leggiMarcatore(c)?.id ?? "");
    const nome = voce?.nome ?? c.name;
    if (voce?.sede) {
      registra(false, "scartata: è legata ai giorni in sede", nome);
      continue;
    }
    const attuale = personaDi(c, cat, membri);
    const chi = p.chi ?? attuale;
    if (p.chi && (attuale === "insieme" || p.chi === "insieme")) {
      registra(false, "scartata: le faccende da fare insieme non cambiano persona", nome);
      continue;
    }
    if (chi !== "insieme" && !cat.persone.includes(chi)) {
      registra(false, `scartata: "${chi}" non è una persona di casa`, nome);
      continue;
    }
    const quando = p.quando ? new Date(p.quando) : new Date(c.nextDueDate!);
    if (Number.isNaN(quando.getTime())) {
      registra(false, "scartata: data non valida", nome);
      continue;
    }
    const fine = istanteLocale(sommaGiorni(settimana, 7));
    if (quando <= adesso || quando >= fine || confronta(domenicaDi(giornoDi(quando)), settimana) !== 0) {
      registra(false, "scartata: la nuova data non è in questa settimana o è già passata", nome);
      continue;
    }
    const spostamento = p.quando ? minutiDelGiorno(quando) - minutiDelGiorno(new Date(c.nextDueDate!)) : 0;
    const macchine = voce ? macchineOltre(voce, giornoDi(quando), cat, spostamento)[0] : undefined;
    if (macchine) {
      registra(false, `scartata: ${macchine}`, nome);
      continue;
    }
    const chiControlla = chi === "insieme" ? cat.persone : [chi];
    const ostacolo = chiControlla.map((x) => impedimento(x, quando, cat)).find(Boolean);
    if (ostacolo) {
      registra(false, `scartata: ${ostacolo}`, nome);
      continue;
    }
    const azioni: string[] = [];
    if (prova) {
      const cosa = [p.quando ? `spostarla a ${quando.toISOString()}` : "", p.chi && chi !== attuale ? `passarla a ${chi}` : ""].filter(Boolean);
      registra(cosa.length > 0, cosa.length ? `in prova: si potrebbe ${cosa.join(" e ")}` : "nessun cambiamento", nome);
      continue;
    }
    if (p.quando && quando.getTime() !== new Date(c.nextDueDate!).getTime()) {
      await client.spostaScadenza(c.id, quando);
      azioni.push(`spostata a ${quando.toISOString()}`);
    }
    if (p.chi && chi !== attuale) {
      const nuovo = utenteDi(chi, membri)?.userId;
      if (nuovo === undefined || !c.assignees.some((a) => a.userId === nuovo)) {
        registra(false, `scartata: ${chi} non è tra gli assegnatari possibili`, nome);
        continue;
      }
      await client.assegna(c.id, nuovo);
      stato.riassegnazioni.push({ choreId: c.id, nome, daUtente: c.assignedTo, aUtente: nuovo, scadenza: quando.toISOString() });
      azioni.push(`passata da ${attuale} a ${chi} per questa volta`);
    }
    registra(azioni.length > 0, azioni.length ? azioni.join(", ") : "nessun cambiamento", nome);
  }
  // Il registro tiene le ultime 200 voci
  stato.registro = stato.registro.slice(-200);
  if (!prova) scriviStato(statoPercorso, stato);
  return esiti;
}

