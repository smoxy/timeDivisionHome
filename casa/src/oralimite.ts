// Ora limite delle macchine ad alto consumo: la fine dell'ultima ora in cui il fotovoltaico
// dovrebbe dare almeno la soglia (1,5 kW), con la previsione di Forecast.Solar corretta da
// quanto il sole ha reso davvero nell'ultima ora (o, se non si sa ancora, da stamattina).
// Sostituisce l'ora fissa di meta.macchine.entro. Per il semaforo delle macchine dà anche il sole
// che resta oggi e l'ora migliore prima del limite.

import { config } from "./config.ts";
import { comandoWebSocket, numero, statoEntita } from "./homeassistant.ts";
import { confronta, giornoDi, isoGiorno, istanteLocale, leggiOra, oraLocale } from "./tempo.ts";

export type OraLimite = {
  oraLimite: string | null; // "HH:MM" locale; null se oggi il sole non basta o la previsione manca
  motivo: "previsione" | "poco sole" | "senza previsione";
  rapporto?: number; // reale/previsto (ultima ora o mattina), tra RAPPORTO_MIN e RAPPORTO_MAX
  solePrevistoKWh?: number; // energia prevista da adesso al tramonto, già corretta dal rapporto
  oraMigliore?: string | null; // "HH:MM": un'ora più avanti (entro il limite) con molto più sole; null se adesso va bene
};

export type Campione = { t: number; kwh: number }; // energia prodotta oggi letta all'istante t (ms)

export type OraPrevista = { inizio: Date; wh: number }; // energia prevista in quell'ora

const ORA_MS = 3600_000;
const RAPPORTO_MIN = 0.5;
const RAPPORTO_MAX = 1.5;
const ORA_SIGNIFICATIVA_WH = 300; // una mattina senza almeno un'ora così passata non dice niente
const ULTIMA_ORA_MIN_WH = 150; // sotto, l'ultima ora prevista è troppo poca per giudicare
const MIGLIORE_DI = 1.15; // un'ora "migliore" deve dare almeno il 15% in più di quella in corso
export const SOGLIA_PREDEFINITA_KW = 1.5;

const limita = (r: number) => Math.min(RAPPORTO_MAX, Math.max(RAPPORTO_MIN, r));

// Energia prevista (Wh) tra gli istanti a e b, con le ore prese per la parte che cade nell'intervallo
export function previstoTra(ore: OraPrevista[], a: number, b: number): number {
  return ore.reduce((somma, o) => {
    const i = o.inizio.getTime();
    const sovrapposto = Math.max(0, Math.min(b, i + ORA_MS) - Math.max(a, i));
    return somma + (o.wh * sovrapposto) / ORA_MS;
  }, 0);
}

// Tiene i campioni di oggi delle ultime due ore; un valore che scende (azzeramento) riparte da capo
export function aggiungiCampione(campioni: Campione[], c: Campione): Campione[] {
  const giorno = isoGiorno(giornoDi(new Date(c.t)));
  const tenuti = campioni.filter(
    (x) => x.t > c.t - 2 * ORA_MS && x.t < c.t && isoGiorno(giornoDi(new Date(x.t))) === giorno && x.kwh <= c.kwh,
  );
  return [...tenuti, c];
}

// Reale/previsto dell'ultima ora (tra 40 e 75 minuti di campioni), o undefined se non si può dire
export function rapportoUltimaOra(ore: OraPrevista[], campioni: Campione[], adesso: Date): number | undefined {
  const t1 = adesso.getTime();
  const ultimo = campioni.at(-1);
  if (!ultimo || t1 - ultimo.t > 15 * 60_000) return undefined;
  const primo = campioni.find((c) => c.t >= t1 - 75 * 60_000);
  if (!primo || ultimo.t - primo.t < 40 * 60_000) return undefined;
  const previsto = previstoTra(ore, primo.t, ultimo.t);
  if (previsto < ULTIMA_ORA_MIN_WH) return undefined;
  return limita(((ultimo.kwh - primo.kwh) * 1000) / previsto);
}

// Reale/previsto delle ore già passate, per correggere il resto della giornata
function rapportoDelMattino(ore: OraPrevista[], prodottoOggiKWh: number | undefined, adesso: Date): number {
  if (prodottoOggiKWh === undefined || Number.isNaN(prodottoOggiKWh)) return 1;
  const finite = ore.filter((o) => o.inizio.getTime() + ORA_MS <= adesso.getTime());
  if (!finite.some((o) => o.wh > ORA_SIGNIFICATIVA_WH)) return 1;
  // L'ora in corso conta per la parte già trascorsa
  const previstoWh = ore.reduce((somma, o) => {
    const trascorsa = Math.min(1, Math.max(0, (adesso.getTime() - o.inizio.getTime()) / ORA_MS));
    return somma + o.wh * trascorsa;
  }, 0);
  if (previstoWh <= 0) return 1;
  return limita((prodottoOggiKWh * 1000) / previstoWh);
}

// rapportoRecente (ultima ora), se c'è, vale più di quello di tutta la mattina
export function calcolaOraLimite(d: {
  ore: OraPrevista[];
  prodottoOggiKWh?: number;
  rapportoRecente?: number;
  adesso: Date;
  sogliaKW: number;
}): { oraLimite: string | null; motivo: "previsione" | "poco sole"; rapporto: number } {
  const rapporto = d.rapportoRecente ?? rapportoDelMattino(d.ore, d.prodottoOggiKWh, d.adesso);
  const buone = d.ore.filter((o) => o.wh * rapporto >= d.sogliaKW * 1000);
  if (buone.length === 0) return { oraLimite: null, motivo: "poco sole", rapporto };
  const ultima = buone.reduce((a, b) => (b.inizio > a.inizio ? b : a));
  return { oraLimite: oraLocale(new Date(ultima.inizio.getTime() + ORA_MS)), motivo: "previsione", rapporto };
}

// Per il semaforo: sole previsto da adesso a sera, e un'ora migliore più avanti (entro il limite) se c'è
export function previsioneMacchine(d: {
  ore: OraPrevista[];
  rapporto: number;
  adesso: Date;
  oraLimite: string | null;
}): { solePrevistoKWh: number; oraMigliore: string | null } {
  const t = d.adesso.getTime();
  const fineGiorno = istanteLocale(giornoDi(d.adesso), 23, 59).getTime() + 60_000;
  const solePrevistoKWh = Math.round((previstoTra(d.ore, t, fineGiorno) * d.rapporto) / 100) / 10;
  const limite = d.oraLimite ? istanteOraLimite(d.oraLimite, d.adesso).getTime() : fineGiorno;
  const inCorso = d.ore.find((o) => o.inizio.getTime() <= t && t < o.inizio.getTime() + ORA_MS);
  const dopo = d.ore.filter((o) => o.inizio.getTime() > t && o.inizio.getTime() + ORA_MS <= limite);
  if (dopo.length === 0) return { solePrevistoKWh, oraMigliore: null };
  const migliore = dopo.reduce((a, b) => (b.wh > a.wh ? b : a));
  const adessoWh = inCorso?.wh ?? 0;
  const meglio = migliore.wh * d.rapporto >= ORA_SIGNIFICATIVA_WH && migliore.wh > adessoWh * MIGLIORE_DI;
  return { solePrevistoKWh, oraMigliore: meglio ? oraLocale(migliore.inizio) : null };
}

// L'istante di oggi corrispondente a un'ora limite "HH:MM"
export function istanteOraLimite(oraLimite: string, adesso: Date): Date {
  const { ore, minuti } = leggiOra(oraLimite);
  return istanteLocale(giornoDi(adesso), ore, minuti);
}

type PrevisioneSolare = Record<string, { wh_hours?: Record<string, number> }>;

// Energia prodotta oggi in kWh, qualunque unità dia il sensore
async function prodottoOggi(): Promise<number | undefined> {
  try {
    const s = await statoEntita(config.ha.produzioneOggi);
    const n = numero(s);
    if (n === undefined) return undefined;
    return s?.unita === "Wh" ? n / 1000 : s?.unita === "MWh" ? n * 1000 : n;
  } catch {
    return undefined; // senza il reale si usa la previsione così com'è
  }
}

let campioni: Campione[] = [];

async function calcolaDaHomeAssistant(adesso: Date, sogliaKW: number): Promise<OraLimite> {
  const senza: OraLimite = { oraLimite: null, motivo: "senza previsione" };
  const { url, token } = config.ha;
  if (!url || !token) return senza;
  try {
    const [previsione, prodotto] = await Promise.all([
      comandoWebSocket<PrevisioneSolare>(url, token, { type: "energy/solar_forecast" }, 6000),
      prodottoOggi(),
    ]);
    // Più impianti (voci di configurazione) si sommano ora per ora
    const ore = orePreviste(Object.values(previsione ?? {}).map((impianto) => impianto?.wh_hours ?? {}), adesso);
    if (ore.length === 0) return senza;
    if (prodotto !== undefined && !Number.isNaN(prodotto)) campioni = aggiungiCampione(campioni, { t: adesso.getTime(), kwh: prodotto });
    const rapportoRecente = rapportoUltimaOra(ore, campioni, adesso);
    const r = calcolaOraLimite({ ore, prodottoOggiKWh: prodotto, rapportoRecente, adesso, sogliaKW });
    return { ...r, ...previsioneMacchine({ ore, rapporto: r.rapporto, adesso, oraLimite: r.oraLimite }) };
  } catch (e) {
    console.error("[oralimite]", (e as Error).message);
    return senza;
  }
}

// Le chiavi di wh_hours (Forecast.Solar) sono la FINE del periodo: la prima è l'alba con 0 Wh,
// l'ultima il tramonto con l'energia dell'ora incompleta. L'ora prevista comincia un'ora prima.
// Più impianti si sommano per istante; restano solo le ore che finiscono oggi.
export function orePreviste(impianti: Record<string, number>[], adesso: Date): OraPrevista[] {
  const perFine = new Map<number, number>();
  for (const wh_hours of impianti) {
    for (const [chiave, wh] of Object.entries(wh_hours)) {
      const t = new Date(chiave).getTime();
      if (!Number.isNaN(t) && Number.isFinite(wh)) perFine.set(t, (perFine.get(t) ?? 0) + wh);
    }
  }
  const oggi = giornoDi(adesso);
  return [...perFine]
    .filter(([fine]) => confronta(giornoDi(new Date(fine)), oggi) === 0)
    .map(([fine, wh]) => ({ inizio: new Date(fine - ORA_MS), wh }))
    .sort((a, b) => a.inizio.getTime() - b.inizio.getTime());
}

// La previsione cambia poco: si rilegge ogni 10 minuti (1 minuto se non è arrivata)
const DURATA_CACHE_MS = 10 * 60_000;
const DURATA_CACHE_ERRORE_MS = 60_000;
let cache: { chiave: string; scade: number; valore: Promise<OraLimite> } | null = null;

export function leggiOraLimite(adesso = new Date(), sogliaKW = SOGLIA_PREDEFINITA_KW): Promise<OraLimite> {
  const chiave = `${isoGiorno(giornoDi(adesso))}|${sogliaKW}`;
  if (cache && cache.chiave === chiave && cache.scade > Date.now()) return cache.valore;
  const voce = { chiave, scade: Date.now() + DURATA_CACHE_MS, valore: calcolaDaHomeAssistant(adesso, sogliaKW) };
  cache = voce;
  void voce.valore.then((v) => {
    if (v.motivo === "senza previsione") voce.scade = Date.now() + DURATA_CACHE_ERRORE_MS;
  });
  return voce.valore;
}
