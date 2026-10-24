const FUSO = "Europe/Rome";

const giornoLungo = new Intl.DateTimeFormat("it-IT", { timeZone: FUSO, weekday: "long", day: "numeric", month: "long" });
const giornoBreve = new Intl.DateTimeFormat("it-IT", { timeZone: "UTC", weekday: "long", day: "numeric" });
const meseGiorno = new Intl.DateTimeFormat("it-IT", { timeZone: "UTC", day: "numeric", month: "long" });
const ora = new Intl.DateTimeFormat("it-IT", { timeZone: FUSO, hour: "2-digit", minute: "2-digit" });

const maiuscola = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const dataLunga = (istante: string | Date) => maiuscola(giornoLungo.format(new Date(istante)));
export const nomeGiorno = (iso: string) => maiuscola(giornoBreve.format(new Date(`${iso}T00:00:00Z`)));
export const dataBreve = (iso: string) => meseGiorno.format(new Date(`${iso}T00:00:00Z`));
export const oraDi = (istante: string) => ora.format(new Date(istante));

export function durata(minuti: number): string {
  if (minuti < 60) return `${minuti} min`;
  const h = Math.floor(minuti / 60);
  const m = minuti % 60;
  return m ? `${h} h ${m}` : `${h} h`;
}

export function sommaGiorniIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function minutiDa(orario: string): number {
  const [h, m] = orario.split(":").map(Number);
  return h * 60 + m;
}

// Colore di ciascuno: i primi due in meta.persone, poi "insieme".
const COLORI = ["var(--persona-1)", "var(--persona-2)", "var(--persona-3)"];
export function colore(chi: string, persone: string[]): string {
  if (chi === "insieme") return "var(--insieme)";
  const i = persone.indexOf(chi);
  return COLORI[i >= 0 ? i % COLORI.length : 2];
}
