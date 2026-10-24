export type Sole = {
  fonte: "home-assistant" | "stagione";
  produzioneW?: number;
  batteriaPct?: number;
  piccoOggi?: string;
  piccoDomani?: string;
  fascia: { da: string; a: string };
  errore?: string;
};

export type Faccenda = {
  id: number;
  nome: string;
  chi: string;
  quando: string;
  ora: string;
  inRitardo: boolean;
  minuti?: number;
  area?: string;
  sole: boolean;
  note?: string;
};

export type Oggi = {
  adesso: string;
  giorno: { data: string; sigla: string; alba: string; tramonto: string };
  sabato: { inizio: string; fine: string; inCorso: boolean };
  sole: Sole;
  faccende: Faccenda[];
};

export type VoceSettimana = {
  id: string;
  nome: string;
  chi: string;
  giorno: string;
  ora: string;
  minuti: number;
  area: string;
  sole: boolean;
  spostataDalSabato: boolean;
  scambiata: boolean;
};

export type Settimana = {
  da: string;
  oggi: string;
  giorni: { data: string; sigla: string; tramonto?: string; voci: VoceSettimana[] }[];
  minuti: Record<string, number>;
  personaConSede?: string;
};

export type VoceSpesa = { id: number; nome: string; quantita: number; presa: boolean };

export class NonAutorizzato extends Error {}

async function chiama<T>(metodo: string, percorso: string, corpo?: unknown): Promise<T> {
  const r = await fetch(percorso, {
    method: metodo,
    credentials: "same-origin",
    headers: corpo === undefined ? {} : { "content-type": "application/json" },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  if (r.status === 401 && percorso !== "/api/accesso") throw new NonAutorizzato();
  const dati = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(dati.errore ?? `Il server ha risposto ${r.status}`);
  return dati as T;
}

export const api = {
  persone: () => chiama<{ persone: string[]; luogo: string }>("GET", "/api/persone"),
  accedi: (persona: string, password: string) => chiama<{ persona: string }>("POST", "/api/accesso", { persona, password }),
  esci: () => chiama<unknown>("POST", "/api/esci"),
  io: () => chiama<{ persona: string }>("GET", "/api/io"),
  oggi: () => chiama<Oggi>("GET", "/api/oggi"),
  fatta: (id: number) => chiama<unknown>("POST", `/api/faccende/${id}/fatta`),
  salta: (id: number) => chiama<unknown>("POST", `/api/faccende/${id}/salta`),
  settimana: (da?: string) => chiama<Settimana>("GET", `/api/settimana${da ? `?da=${da}` : ""}`),
  scambio: (inSede: string, daRemoto: string) =>
    chiama<{ esiti: { faccenda: string; azione: string }[] }>("POST", "/api/sede/scambio", { inSede, daRemoto }),
  spesa: () => chiama<{ voci: VoceSpesa[] }>("GET", "/api/spesa"),
  aggiungi: (nome: string, quantita?: number) => chiama<unknown>("POST", "/api/spesa", { nome, quantita }),
  segna: (id: number, presa: boolean) => chiama<unknown>("PUT", `/api/spesa/${id}`, { presa }),
  togliPrese: () => chiama<{ tolte: number }>("DELETE", "/api/spesa/prese"),
};
