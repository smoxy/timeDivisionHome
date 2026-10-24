// Fotovoltaico: legge da Home Assistant produzione, batteria e picco previsto,
// e suggerisce la fascia in cui far partire le macchine.

import { config } from "./config.ts";
import { giornoDi, istanteLocale, oraLocale } from "./tempo.ts";

export type Sole = {
  fonte: "home-assistant" | "stagione";
  produzioneW?: number;
  batteriaPct?: number;
  batteriaUsabileKWh?: number; // sopra la riserva minima
  piccoOggi?: string;
  piccoDomani?: string;
  fascia: { da: string; a: string };
  errore?: string;
};

// Fasce di partenza del piano: inverno nov-feb, estate mag-ago, mezza stagione il resto.
export function fasciaDiStagione(mese: number): { da: string; a: string } {
  if ([11, 12, 1, 2].includes(mese)) return { da: "10:30", a: "14:30" };
  if ([5, 6, 7, 8].includes(mese)) return { da: "09:00", a: "17:00" };
  return { da: "10:00", a: "16:00" };
}

type Stato = { valore: string; unita?: string };

async function stato(entita: string | undefined): Promise<Stato | undefined> {
  const { url, token } = config.ha;
  if (!url || !token || !entita) return undefined;
  const r = await fetch(`${url.replace(/\/$/, "")}/api/states/${entita}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) throw new Error(`Home Assistant ${entita}: ${r.status}`);
  const dati = await r.json();
  const valore = dati.state as string;
  return valore === "unknown" || valore === "unavailable" ? undefined : { valore, unita: dati.attributes?.unit_of_measurement };
}

function numero(s: Stato | undefined): number | undefined {
  const n = Number(s?.valore);
  return s === undefined || Number.isNaN(n) ? undefined : n;
}

// Le integrazioni del fotovoltaico danno la potenza in W o in kW
function watt(s: Stato | undefined): number | undefined {
  const n = numero(s);
  if (n === undefined) return undefined;
  return s?.unita === "kW" ? n * 1000 : s?.unita === "MW" ? n * 1_000_000 : n;
}

function ora(s: Stato | undefined): string | undefined {
  if (!s) return undefined;
  const t = new Date(s.valore);
  return Number.isNaN(t.getTime()) ? undefined : oraLocale(t);
}

export async function leggiSole(adesso = new Date()): Promise<Sole> {
  const stagione = fasciaDiStagione(giornoDi(adesso).mese);
  if (!config.ha.url || !config.ha.token) return { fonte: "stagione", fascia: stagione };
  try {
    const [potenza, batteria, piccoOggi, piccoDomani] = await Promise.all([
      stato(config.ha.potenza),
      stato(config.ha.batteria),
      stato(config.ha.piccoOggi),
      stato(config.ha.piccoDomani),
    ]);
    const picco = ora(piccoOggi);
    let fascia = stagione;
    if (picco) {
      // Due ore prima del picco e una dopo, senza uscire dalla fascia di stagione
      const [h, m] = picco.split(":").map(Number);
      const t = istanteLocale(giornoDi(adesso), h, m);
      const da = oraLocale(new Date(t.getTime() - 2 * 3600_000));
      const a = oraLocale(new Date(t.getTime() + 3600_000));
      fascia = { da: da > stagione.da ? da : stagione.da, a: a < stagione.a ? a : stagione.a };
    }
    const pct = numero(batteria);
    const { batteriaKWh: capacita, batteriaRiservaPct: riserva } = config.ha;
    return {
      fonte: "home-assistant",
      produzioneW: watt(potenza),
      batteriaPct: pct,
      batteriaUsabileKWh:
        pct !== undefined && capacita > 0 ? Math.max(0, ((pct - riserva) / 100) * capacita) : undefined,
      piccoOggi: picco,
      piccoDomani: ora(piccoDomani),
      fascia,
    };
  } catch (e) {
    return { fonte: "stagione", fascia: stagione, errore: (e as Error).message };
  }
}
