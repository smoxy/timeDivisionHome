// Lavori periodici: correggono in Donetick quello che le sue ricorrenze non sanno fare.
//  - mesi: le regole "N-esimo giorno del mese" solo nei mesi giusti (pari, dispari, ogni 3 mesi)
//  - stagioni: archivia e ripristina le faccende con attiva_se
//  - ritardo: una faccenda fatta in ritardo vale anche per oggi, non ricompare subito
//  - doppioni: tra faccende con lo stesso concetto rimaste indietro se ne tiene una sola
//  - sabato: niente scade dal tramonto del venerdì al tramonto del sabato

import { attivaIl, cadeIl, meseAmmesso, prossima } from "./calendario.ts";
import type { Catalogo } from "./catalogo.ts";
import { type Donetick, type DonetickChore, leggiMarcatore } from "./donetick.ts";
import { dopoIlSabato, nelSabato, sabatoCorrenteOProssimo, sabatoDelVenerdi } from "./sole.ts";
import { leggiStato, scriviStato } from "./stato.ts";
import { confronta, type Giorno, giornoDi, istanteLocale, oraLocale, parti, SIGLE_GIORNI, type SiglaGiorno, sommaGiorni } from "./tempo.ts";

export type Esito = { faccenda: string; azione: string };

export async function eseguiLavori(client: Donetick, cat: Catalogo, adesso = new Date(), statoPercorso?: string): Promise<Esito[]> {
  const esiti: Esito[] = [];
  const voci = new Map(cat.faccende.map((v) => [v.id, v]));
  const tutte = await client.faccende(true);

  // Stagioni
  for (const c of tutte) {
    const voce = voci.get(leggiMarcatore(c)?.id ?? "");
    if (!voce?.attivaSe) continue;
    const attiva = attivaIl(voce, giornoDi(adesso), cat);
    if (attiva && !c.isActive) {
      await client.ripristina(c.id);
      esiti.push({ faccenda: c.name, azione: "ripristinata per la stagione" });
      const p = prossima(voce, adesso, cat);
      if (p) await client.spostaScadenza(c.id, p.quando);
    } else if (!attiva && c.isActive) {
      await client.archivia(c.id);
      esiti.push({ faccenda: c.name, azione: "archiviata per la stagione" });
    }
  }

  const attive = (await client.faccende(false)).filter((c) => c.isActive && c.nextDueDate);

  // Mesi
  for (const c of attive) {
    const voce = voci.get(leggiMarcatore(c)?.id ?? "");
    if (!voce || voce.mesi === undefined || voce.occorrenza === undefined) continue;
    const scadenza = new Date(c.nextDueDate!);
    if (meseAmmesso(voce.mesi, giornoDi(scadenza).mese)) continue;
    const p = prossima(voce, new Date(scadenza.getTime() - 60_000), cat);
    if (p) {
      await client.spostaScadenza(c.id, p.quando);
      c.nextDueDate = p.quando.toISOString();
      esiti.push({ faccenda: c.name, azione: `spostata al mese giusto: ${p.quando.toISOString()}` });
    }
  }

  // Sede: le voci legate ai giorni in sede stanno solo nei giorni giusti della loro settimana
  for (const c of attive) {
    const voce = voci.get(leggiMarcatore(c)?.id ?? "");
    if (!voce?.sede) continue;
    const scadenza = new Date(c.nextDueDate!);
    if (cadeIl(voce, giornoDi(scadenza), cat)) continue;
    const p = prossima(voce, new Date(scadenza.getTime() - 60_000), cat);
    if (!p) continue;
    await client.spostaScadenza(c.id, p.quando);
    c.nextDueDate = p.quando.toISOString();
    esiti.push({ faccenda: c.name, azione: `portata al giorno giusto per la sede: ${p.quando.toISOString()}` });
  }

  // Riassegnazioni temporanee dell'assistente: finita l'occorrenza, torna l'assegnatario di prima
  if (statoPercorso) {
    const stato = leggiStato(statoPercorso);
    const rimaste = [];
    for (const r of stato.riassegnazioni) {
      const c = tutte.find((x) => x.id === r.choreId);
      const finita = !c || !c.nextDueDate || new Date(c.nextDueDate) > new Date(r.scadenza);
      if (!finita) {
        rimaste.push(r);
        continue;
      }
      if (c && r.daUtente != null && c.assignedTo !== r.daUtente) {
        await client.assegna(c.id, r.daUtente);
        esiti.push({ faccenda: c.name, azione: "riassegnata a chi l'aveva prima" });
      }
    }
    if (rimaste.length !== stato.riassegnazioni.length) {
      stato.riassegnazioni = rimaste;
      scriviStato(statoPercorso, stato);
    }
  }

  // Ritardo: Donetick calcola la prossima scadenza da quella saltata, quindi una faccenda
  // fatta in ritardo ricomparirebbe subito. La si porta alla prima occorrenza dopo il giorno in cui è stata fatta.
  const fatteDi = new Map<number, Date>();
  for (const h of await client.storico(2)) {
    if (h.status !== 1 || !h.performedAt) continue;
    const quando = new Date(h.performedAt);
    if (!fatteDi.has(h.choreId) || fatteDi.get(h.choreId)! < quando) fatteDi.set(h.choreId, quando);
  }
  for (const c of attive) {
    const fatta = fatteDi.get(c.id);
    const voce = voci.get(leggiMarcatore(c)?.id ?? "");
    if (!fatta || !voce) continue;
    const giornoFatta = giornoDi(fatta);
    if (confronta(giornoDi(new Date(c.nextDueDate!)), giornoFatta) > 0) continue;
    const p = prossima(voce, istanteLocale(sommaGiorni(giornoFatta, 1)), cat);
    if (!p) continue;
    await client.spostaScadenza(c.id, p.quando);
    c.nextDueDate = p.quando.toISOString();
    esiti.push({ faccenda: c.name, azione: `fatta in ritardo, prossima il ${p.quando.toISOString()}` });
  }

  // Doppioni: per ogni persona (o "insieme") e concetto, tra le faccende scadute prima di oggi
  // e quelle di oggi se ne tiene una sola, la più recente; le altre passano alla prossima occorrenza.
  const fineOggi = istanteLocale(sommaGiorni(giornoDi(adesso), 1));
  const gruppi = new Map<string, DonetickChore[]>();
  for (const c of attive) {
    const voce = voci.get(leggiMarcatore(c)?.id ?? "");
    if (!voce || new Date(c.nextDueDate!) >= fineOggi) continue;
    const chiave = `${c.assignedTo ?? "insieme"}|${voce.concetto}`;
    gruppi.set(chiave, [...(gruppi.get(chiave) ?? []), c]);
  }
  for (const gruppo of gruppi.values()) {
    if (gruppo.length < 2) continue;
    gruppo.sort((a, b) => a.nextDueDate!.localeCompare(b.nextDueDate!));
    const tenuta = gruppo.at(-1)!;
    for (const c of gruppo.slice(0, -1)) {
      const voce = voci.get(leggiMarcatore(c)!.id)!;
      const p = prossima(voce, fineOggi, cat);
      if (!p) continue;
      await client.spostaScadenza(c.id, p.quando);
      c.nextDueDate = p.quando.toISOString();
      esiti.push({ faccenda: c.name, azione: `assorbita da "${tenuta.name}", prossima il ${p.quando.toISOString()}` });
    }
  }

  // Sabato: controlla il sabato in corso e i due successivi
  const finestre = [sabatoCorrenteOProssimo(adesso, cat.luogo)];
  for (let i = 1; i <= 2; i++) finestre.push(sabatoDelVenerdi(sommaGiorni(finestre[0].venerdi, 7 * i), cat.luogo));
  for (const c of attive) {
    const scadenza = new Date(c.nextDueDate!);
    const f = finestre.find((w) => scadenza >= w.inizio && scadenza < w.fine);
    if (!f) continue;
    const dopo = dopoIlSabato(f);
    await client.spostaScadenza(c.id, dopo);
    esiti.push({ faccenda: c.name, azione: `spostata dopo il sabato: ${dopo.toISOString()}` });
  }

  return esiti;
}

// Giorni in sede che cambiano: ogni giorno che diventa in sede si abbina, in ordine, a uno che torna da remoto.
export function abbinaGiorni(prima: SiglaGiorno[], dopo: SiglaGiorno[]): { lascia: SiglaGiorno; prende: SiglaGiorno }[] {
  const ordine = (a: SiglaGiorno, b: SiglaGiorno) => SIGLE_GIORNI.indexOf(a) - SIGLE_GIORNI.indexOf(b);
  const lasciati = prima.filter((g) => !dopo.includes(g)).sort(ordine);
  const presi = dopo.filter((g) => !prima.includes(g)).sort(ordine);
  return presi.slice(0, lasciati.length).map((prende, i) => ({ lascia: lasciati[i], prende }));
}

export function fuoriCasa(t: Date, cat: Catalogo): boolean {
  const ora = oraLocale(t);
  const [da, a] = cat.fuoriCasaInSede.map((x) => x.padStart(5, "0"));
  return ora >= da && ora < a;
}

// Le faccende di chi ha i giorni in sede (e quelle da fare insieme) che cadono mentre è fuori casa
// in un nuovo giorno in sede passano, alla stessa ora, al giorno abbinato che torna da remoto.
// Le voci con "sede" non si toccano qui: le sistema la regola "sede" di eseguiLavori.
export async function applicaSede(
  client: Donetick,
  idPersona: number,
  domenica: Giorno,
  prima: SiglaGiorno[],
  dopo: SiglaGiorno[],
  cat: Catalogo,
  adesso = new Date(),
): Promise<Esito[]> {
  const esiti: Esito[] = [];
  const voci = new Map(cat.faccende.map((v) => [v.id, v]));
  const coppie = abbinaGiorni(prima, dopo);
  if (coppie.length === 0) return esiti;
  const giornoDiSigla = (s: SiglaGiorno) => sommaGiorni(domenica, SIGLE_GIORNI.indexOf(s));
  for (const c of await client.faccende(false)) {
    if (!c.isActive || !c.nextDueDate || !assegnataA(c, idPersona)) continue;
    if (voci.get(leggiMarcatore(c)?.id ?? "")?.sede) continue;
    const scadenza = new Date(c.nextDueDate);
    if (scadenza <= adesso || !fuoriCasa(scadenza, cat)) continue;
    const coppia = coppie.find((k) => confronta(giornoDiSigla(k.prende), giornoDi(scadenza)) === 0);
    if (!coppia) continue;
    const { ore, minuti } = parti(scadenza);
    let nuova = istanteLocale(giornoDiSigla(coppia.lascia), ore, minuti);
    if (nuova <= adesso) {
      esiti.push({ faccenda: c.name, azione: "non spostata: il giorno libero è già passato" });
      continue;
    }
    const s = nelSabato(nuova, cat.luogo);
    if (s) nuova = dopoIlSabato(s);
    await client.spostaScadenza(c.id, nuova);
    esiti.push({ faccenda: c.name, azione: `spostata a ${nuova.toISOString()} per il cambio dei giorni in sede` });
  }
  return esiti;
}

export function assegnataA(c: DonetickChore, idPersona: number): boolean {
  return c.assignedTo === idPersona || (c.assignedTo == null && c.assignees.some((a) => a.userId === idPersona));
}
