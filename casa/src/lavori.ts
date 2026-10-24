// Lavori periodici: correggono in Donetick quello che le sue ricorrenze non sanno fare.
//  - mesi: le regole "N-esimo giorno del mese" solo nei mesi giusti (pari, dispari, ogni 3 mesi)
//  - stagioni: archivia e ripristina le faccende con attiva_se
//  - sabato: niente scade dal tramonto del venerdì al tramonto del sabato

import { attivaIl, meseAmmesso, prossima } from "./calendario.ts";
import type { Catalogo } from "./catalogo.ts";
import { type Donetick, type DonetickChore, leggiMarcatore } from "./donetick.ts";
import { dopoIlSabato, nelSabato, sabatoCorrenteOProssimo, sabatoDelVenerdi } from "./sole.ts";
import { giornoDi, sommaGiorni } from "./tempo.ts";

export type Esito = { faccenda: string; azione: string };

export async function eseguiLavori(client: Donetick, cat: Catalogo, adesso = new Date()): Promise<Esito[]> {
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

// Chi ha i giorni in sede cambia un giorno: le sue faccende del nuovo giorno in sede
// passano al giorno che diventa da remoto, alla stessa ora.
export async function scambiaSede(
  client: Donetick,
  idPersona: number,
  daRemoto: { anno: number; mese: number; giorno: number },
  inSede: { anno: number; mese: number; giorno: number },
  cat: Catalogo,
): Promise<Esito[]> {
  const esiti: Esito[] = [];
  const spostamento = Date.UTC(daRemoto.anno, daRemoto.mese - 1, daRemoto.giorno) - Date.UTC(inSede.anno, inSede.mese - 1, inSede.giorno);
  for (const c of await client.faccende(false)) {
    if (!c.isActive || !c.nextDueDate || !assegnataA(c, idPersona)) continue;
    const scadenza = new Date(c.nextDueDate);
    const g = giornoDi(scadenza);
    if (g.anno !== inSede.anno || g.mese !== inSede.mese || g.giorno !== inSede.giorno) continue;
    let nuova = new Date(scadenza.getTime() + spostamento);
    const s = nelSabato(nuova, cat.luogo);
    if (s) nuova = dopoIlSabato(s);
    await client.spostaScadenza(c.id, nuova);
    esiti.push({ faccenda: c.name, azione: `spostata a ${nuova.toISOString()}` });
  }
  return esiti;
}

export function assegnataA(c: DonetickChore, idPersona: number): boolean {
  return c.assignedTo === idPersona || (c.assignedTo == null && c.assignees.some((a) => a.userId === idPersona));
}
