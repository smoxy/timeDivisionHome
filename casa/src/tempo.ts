// Date di calendario e orari nel fuso di casa (Europe/Rome).
// Un Giorno è una data senza ora; gli istanti restano Date (UTC).

export const FUSO = "Europe/Rome";

export type Giorno = { anno: number; mese: number; giorno: number };

export const SIGLE_GIORNI = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"] as const;
export type SiglaGiorno = (typeof SIGLE_GIORNI)[number];

const formatoParti = new Intl.DateTimeFormat("en-US", {
  timeZone: FUSO,
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
  hourCycle: "h23",
});

export type Parti = Giorno & { ore: number; minuti: number; secondi: number };

export function parti(istante: Date): Parti {
  const p: Record<string, number> = {};
  for (const { type, value } of formatoParti.formatToParts(istante)) {
    if (type !== "literal") p[type] = Number(value);
  }
  return { anno: p.year, mese: p.month, giorno: p.day, ore: p.hour, minuti: p.minute, secondi: p.second };
}

export function giornoDi(istante: Date): Giorno {
  const { anno, mese, giorno } = parti(istante);
  return { anno, mese, giorno };
}

// Scarto del fuso in millisecondi in un certo istante (+1 h d'inverno, +2 h d'estate).
function scarto(istante: Date): number {
  const p = parti(istante);
  const comeUtc = Date.UTC(p.anno, p.mese - 1, p.giorno, p.ore, p.minuti, p.secondi);
  return comeUtc - Math.floor(istante.getTime() / 1000) * 1000;
}

// Istante corrispondente a un orario locale. Nelle ore che il cambio d'ora salta
// o ripete prende il primo istante valido.
export function istanteLocale(g: Giorno, ore = 0, minuti = 0): Date {
  const comeUtc = Date.UTC(g.anno, g.mese - 1, g.giorno, ore, minuti);
  let t = new Date(comeUtc - scarto(new Date(comeUtc)));
  const corretto = new Date(comeUtc - scarto(t));
  if (corretto.getTime() !== t.getTime()) t = corretto;
  return t;
}

export function sommaGiorni(g: Giorno, n: number): Giorno {
  const d = new Date(Date.UTC(g.anno, g.mese - 1, g.giorno + n));
  return { anno: d.getUTCFullYear(), mese: d.getUTCMonth() + 1, giorno: d.getUTCDate() };
}

export function giornoSettimana(g: Giorno): number {
  return new Date(Date.UTC(g.anno, g.mese - 1, g.giorno)).getUTCDay();
}

export function sigla(g: Giorno): SiglaGiorno {
  return SIGLE_GIORNI[giornoSettimana(g)];
}

export function giorniTra(da: Giorno, a: Giorno): number {
  return Math.round(
    (Date.UTC(a.anno, a.mese - 1, a.giorno) - Date.UTC(da.anno, da.mese - 1, da.giorno)) / 86_400_000,
  );
}

export function confronta(a: Giorno, b: Giorno): number {
  return giorniTra(b, a);
}

// La settimana di casa va da domenica a sabato.
export function domenicaDi(g: Giorno): Giorno {
  return sommaGiorni(g, -giornoSettimana(g));
}

export function ultimoDelMese(g: Giorno): number {
  return new Date(Date.UTC(g.anno, g.mese, 0)).getUTCDate();
}

export function isoGiorno(g: Giorno): string {
  return `${g.anno}-${String(g.mese).padStart(2, "0")}-${String(g.giorno).padStart(2, "0")}`;
}

export function leggiGiorno(testo: string): Giorno {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(testo.trim());
  if (!m) throw new Error(`Data non valida: ${testo}`);
  return { anno: Number(m[1]), mese: Number(m[2]), giorno: Number(m[3]) };
}

export function leggiOra(testo: string): { ore: number; minuti: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(testo.trim());
  if (!m) throw new Error(`Orario non valido: ${testo}`);
  return { ore: Number(m[1]), minuti: Number(m[2]) };
}

export function oraLocale(istante: Date): string {
  const p = parti(istante);
  return `${String(p.ore).padStart(2, "0")}:${String(p.minuti).padStart(2, "0")}`;
}
