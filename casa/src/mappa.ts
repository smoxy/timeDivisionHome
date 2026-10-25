// Traduce una voce di faccende.yaml in una faccenda di Donetick, usando le ricorrenze native.
// Quello che Donetick non sa fare (mesi pari e dispari, stagioni, sabato) lo correggono i lavori periodici.

import { attivaIl, prossima } from "./calendario.ts";
import type { Catalogo, Voce } from "./catalogo.ts";
import { marcatore } from "./donetick.ts";
import { FUSO, giornoDi, type SiglaGiorno } from "./tempo.ts";

const GIORNI_EN: Record<SiglaGiorno, string> = {
  dom: "sunday",
  lun: "monday",
  mar: "tuesday",
  mer: "wednesday",
  gio: "thursday",
  ven: "friday",
  sab: "saturday",
};

const MESI_EN = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

function elencoMesi(mesi: Voce["mesi"]): string[] {
  const numeri = mesi === "pari" ? [2, 4, 6, 8, 10, 12] : mesi === "dispari" ? [1, 3, 5, 7, 9, 11] : (mesi ?? []);
  return numeri.map((n) => MESI_EN[n - 1]);
}

function descrizione(voce: Voce, persona?: string): string {
  const righe = [
    voce.note,
    voce.quando && voce.ogni !== "settimana" ? `Quando: ${voce.quando}` : undefined,
    voce.stagione ? `Stagione: ${voce.stagione}` : undefined,
    [`${voce.minuti} min`, voce.area, voce.sole ? "fasce di sole" : undefined].filter(Boolean).join(" · "),
    marcatore(voce.id, persona),
  ];
  return righe.filter(Boolean).join("\n");
}

export type Avviso = { id: string; messaggio: string };

export function inDonetick(
  voce: Voce,
  persona: string | undefined,
  idUtenti: Map<string, number>,
  cat: Catalogo,
  adesso: Date,
): { chore: Record<string, unknown>; avvisi: Avviso[] } {
  const avvisi: Avviso[] = [];
  const nome = persona ? `${voce.nome} · ${persona}` : voce.nome;

  const chi = persona ?? voce.chi;
  const idDi = (p: string) => {
    const id = idUtenti.get(p.toLowerCase());
    if (id === undefined) throw new Error(`Nessun utente Donetick per "${p}"`);
    return id;
  };
  // Tutti tra gli assegnatari possibili, così una singola occorrenza può passare all'altra persona
  const assignees = cat.persone.map((p) => ({ userId: idDi(p) }));

  const prima = prossima(voce, adesso, cat, true);
  const nextDueDate = prima?.quando.toISOString();
  const meta = (extra: Record<string, unknown>) => ({
    time: nextDueDate ?? adesso.toISOString(),
    timezone: FUSO,
    ...extra,
  });

  let ricorrenza: Record<string, unknown>;
  if (voce.scadenza) {
    ricorrenza = { frequencyType: "once" };
  } else if (voce.ogni === "evento") {
    ricorrenza = { frequencyType: "no_repeat" };
  } else if (voce.ogni === "settimana") {
    if (voce.giorni.length === 0) {
      avvisi.push({ id: voce.id, messaggio: "nessun giorno indicato: non importata" });
      return { chore: {}, avvisi };
    }
    ricorrenza = {
      frequencyType: "days_of_the_week",
      frequencyMetadata: meta({ days: voce.giorni.map((g) => GIORNI_EN[g]), weekPattern: "every_week" }),
    };
  } else if (voce.ogni === "2 settimane") {
    ricorrenza = { frequencyType: "interval", frequency: 2, frequencyMetadata: meta({ unit: "weeks" }) };
  } else if (voce.occorrenza !== undefined) {
    // N-esimo giorno del mese. Donetick ignora il filtro dei mesi su questa regola:
    // per "2 mesi", "3 mesi", pari e dispari ci pensa il lavoro periodico di Casa.
    ricorrenza = {
      frequencyType: "days_of_the_week",
      frequencyMetadata: meta({
        days: voce.giorni.map((g) => GIORNI_EN[g]),
        weekPattern: "week_of_month",
        occurrences: [voce.occorrenza === "ultima" ? -1 : voce.occorrenza],
      }),
    };
  } else if (voce.giornoDelMese !== undefined) {
    ricorrenza = {
      frequencyType: "day_of_the_month",
      frequency: voce.giornoDelMese,
      frequencyMetadata: meta({ months: elencoMesi(voce.mesi) }),
    };
  } else {
    avvisi.push({ id: voce.id, messaggio: "regola non traducibile: non importata" });
    return { chore: {}, avvisi };
  }

  if (!nextDueDate && voce.ogni !== "evento") {
    avvisi.push({ id: voce.id, messaggio: "nessuna data futura: importata senza scadenza" });
  }

  const chore = {
    name: nome,
    description: descrizione(voce, persona),
    ...ricorrenza,
    nextDueDate: voce.ogni === "evento" ? undefined : nextDueDate,
    isRolling: false,
    assignees,
    assignedTo: chi === "insieme" ? undefined : idDi(chi),
    assignStrategy: chi === "insieme" ? "no_assignee" : "keep_last_assigned",
    isActive: attivaIl(voce, giornoDi(adesso), cat),
    notification: true,
    notificationMetadata: { dueDate: true },
    points: voce.minuti > 0 ? voce.minuti : undefined,
  };
  return { chore, avvisi };
}
