import assert from "node:assert/strict";
import { test } from "node:test";
import { tokenHaValido } from "../src/automazioni.ts";
import { config } from "../src/config.ts";
import { calcolaOraLimite, istanteOraLimite, type OraPrevista } from "../src/oralimite.ts";

// Ore del 19 novembre 2026 (CET, +01:00): wh previsti per ogni ora che comincia all'ora indicata
const giorno = (g: string, off: string, previsione: Record<string, number>): OraPrevista[] =>
  Object.entries(previsione).map(([h, wh]) => ({ inizio: new Date(`${g}T${h.padStart(2, "0")}:00:00${off}`), wh }));
const a = (h: string, g = "2026-11-19", off = "+01:00") => new Date(`${g}T${h}:00${off}`);

const sereno = giorno("2026-11-19", "+01:00", {
  "8": 300, "9": 900, "10": 2000, "11": 2800, "12": 3000, "13": 2900, "14": 2800, "15": 1600, "16": 700,
});

test("giornata normale: la fine dell'ultima ora sopra la soglia", () => {
  const r = calcolaOraLimite({ ore: sereno, adesso: a("07:00"), sogliaKW: 1.5 });
  assert.deepEqual(r, { oraLimite: "16:00", motivo: "previsione", rapporto: 1 });
});

test("la soglia è inclusa e l'ora è l'ultima, non la migliore", () => {
  const ore = giorno("2026-11-19", "+01:00", { "9": 1500, "10": 3000, "11": 1499, "12": 800 });
  assert.equal(calcolaOraLimite({ ore, adesso: a("07:00"), sogliaKW: 1.5 }).oraLimite, "11:00");
  assert.equal(calcolaOraLimite({ ore, adesso: a("07:00"), sogliaKW: 2 }).oraLimite, "11:00");
  assert.equal(calcolaOraLimite({ ore, adesso: a("07:00"), sogliaKW: 3.1 }).oraLimite, null);
});

test("nessuna ora raggiunge la soglia: oggi il sole non basta", () => {
  const novembre = giorno("2026-11-19", "+01:00", { "9": 150, "10": 420, "11": 700, "12": 818, "13": 790, "14": 500, "15": 200 });
  assert.deepEqual(calcolaOraLimite({ ore: novembre, adesso: a("07:00"), sogliaKW: 1.5 }), { oraLimite: null, motivo: "poco sole", rapporto: 1 });
});

test("se stamattina il sole ha reso il 60% del previsto, l'ora limite scende", () => {
  // 8-12: previsti 6000 Wh, prodotti 3,6 kWh. Da 2900/2800/1600 si passa a 1740/1680/960
  const r = calcolaOraLimite({ ore: sereno, prodottoOggiKWh: 3.6, adesso: a("12:00"), sogliaKW: 1.5 });
  assert.equal(r.rapporto, 0.6);
  assert.equal(r.oraLimite, "15:00");
  assert.equal(calcolaOraLimite({ ore: sereno, adesso: a("12:00"), sogliaKW: 1.5 }).oraLimite, "16:00"); // senza reale
});

test("il rapporto resta tra 0,5 e 1,5", () => {
  const poco = calcolaOraLimite({ ore: sereno, prodottoOggiKWh: 0.2, adesso: a("12:00"), sogliaKW: 1.5 });
  assert.equal(poco.rapporto, 0.5);
  assert.equal(poco.oraLimite, "13:00"); // resta solo l'ora da 3000 Wh: 1500 basta
  const tanto = calcolaOraLimite({ ore: sereno, prodottoOggiKWh: 20, adesso: a("12:00"), sogliaKW: 1.5 });
  assert.equal(tanto.rapporto, 1.5);
  // con il 150% anche un giorno scarso supera la soglia: 1100 * 1,5 = 1650
  const scarso = giorno("2026-11-19", "+01:00", { "8": 400, "9": 600, "10": 800, "11": 1100, "12": 1100, "13": 600 });
  const r = calcolaOraLimite({ ore: scarso, prodottoOggiKWh: 9, adesso: a("11:00"), sogliaKW: 1.5 });
  assert.deepEqual(r, { oraLimite: "13:00", motivo: "previsione", rapporto: 1.5 });
});

test("presto la mattina nessuna correzione", () => {
  // alle 8:30 non è passata nessuna ora intera
  assert.equal(calcolaOraLimite({ ore: sereno, prodottoOggiKWh: 0.01, adesso: a("08:30"), sogliaKW: 1.5 }).rapporto, 1);
  // alle 9:00 è passata solo l'ora da 300 Wh: non è sopra 0,3 kWh
  assert.equal(calcolaOraLimite({ ore: sereno, prodottoOggiKWh: 0.01, adesso: a("09:00"), sogliaKW: 1.5 }).rapporto, 1);
  // alle 10:00 c'è anche quella da 900 Wh: ora si corregge (produzione 0,6 kWh su 1,2 previsti)
  assert.equal(calcolaOraLimite({ ore: sereno, prodottoOggiKWh: 0.6, adesso: a("10:00"), sogliaKW: 1.5 }).rapporto, 0.5);
  // senza il dato reale si resta sulla previsione
  assert.equal(calcolaOraLimite({ ore: sereno, adesso: a("13:00"), sogliaKW: 1.5 }).rapporto, 1);
});

test("l'ora in corso conta per la parte già trascorsa", () => {
  // alle 10:30: previsti 300 + 900 + metà di 2000 = 2200 Wh, prodotti 1,1 kWh
  assert.equal(calcolaOraLimite({ ore: sereno, prodottoOggiKWh: 1.1, adesso: a("10:30"), sogliaKW: 1.5 }).rapporto, 0.5);
  assert.equal(calcolaOraLimite({ ore: sereno, prodottoOggiKWh: 2.2, adesso: a("10:30"), sogliaKW: 1.5 }).rapporto, 1);
});

test("ultima ora parziale al tramonto", () => {
  const ore = [...sereno, { inizio: a("16:48"), wh: 200 }];
  const r = calcolaOraLimite({ ore, adesso: a("07:00"), sogliaKW: 1.5 });
  assert.equal(r.oraLimite, "16:00"); // la mezz'ora scarsa dopo il tramonto non sposta il limite
  // le ore in disordine non cambiano il risultato
  assert.equal(calcolaOraLimite({ ore: [...ore].reverse(), adesso: a("07:00"), sogliaKW: 1.5 }).oraLimite, "16:00");
});

test("ora locale corretta con il cambio d'ora e con orari in UTC", () => {
  // 28 marzo 2027: da CET a CEST. Alle 17 locali (+02:00) la fine è alle 18:00
  const primavera = giorno("2027-03-28", "+02:00", { "10": 2000, "17": 1800, "18": 900 });
  assert.equal(calcolaOraLimite({ ore: primavera, adesso: a("08:00", "2027-03-28", "+02:00"), sogliaKW: 1.5 }).oraLimite, "18:00");
  // 25 ottobre 2026: da CEST a CET
  const autunno = giorno("2026-10-25", "+01:00", { "11": 2000, "15": 1800, "16": 900 });
  assert.equal(calcolaOraLimite({ ore: autunno, adesso: a("08:00", "2026-10-25", "+01:00"), sogliaKW: 1.5 }).oraLimite, "16:00");
  // Home Assistant può dare le chiavi in UTC: le 14:00Z di luglio sono le 16:00 a Roma
  const luglio = [{ inizio: new Date("2026-07-15T14:00:00Z"), wh: 2500 }];
  assert.equal(calcolaOraLimite({ ore: luglio, adesso: new Date("2026-07-15T05:00:00Z"), sogliaKW: 1.5 }).oraLimite, "17:00");
});

test("l'istante di oggi dell'ora limite", () => {
  assert.equal(istanteOraLimite("15:00", a("09:00")).toISOString(), "2026-11-19T14:00:00.000Z");
  assert.equal(istanteOraLimite("15:00", a("09:00", "2026-07-15", "+02:00")).toISOString(), "2026-07-15T13:00:00.000Z");
});

test("il token di Home Assistant: senza token configurato nessuno entra", () => {
  const prima = config.tokenPerHa;
  try {
    (config as { tokenPerHa?: string }).tokenPerHa = undefined;
    assert.equal(tokenHaValido(undefined), false);
    assert.equal(tokenHaValido(""), false);
    (config as { tokenPerHa?: string }).tokenPerHa = "segreto-di-prova";
    assert.equal(tokenHaValido("segreto-di-prova"), true);
    assert.equal(tokenHaValido("segreto-di-provo"), false);
    assert.equal(tokenHaValido("segreto"), false);
    assert.equal(tokenHaValido(undefined), false);
  } finally {
    (config as { tokenPerHa?: string }).tokenPerHa = prima;
  }
});

test("le chiavi della previsione sono la fine dell'ora: l'ora limite è la fine dell'ultima ora buona", async () => {
  const { orePreviste, calcolaOraLimite } = await import("../src/oralimite.ts");
  // Forma reale di Forecast.Solar: alba con 0 Wh, ore piene, tramonto con l'ora incompleta (ore italiane, UTC+1)
  const wh = {
    "2026-11-20T07:13:00+01:00": 0,
    "2026-11-20T12:00:00+01:00": 1669,
    "2026-11-20T13:00:00+01:00": 1905,
    "2026-11-20T14:00:00+01:00": 1763,
    "2026-11-20T15:00:00+01:00": 1231,
    "2026-11-20T16:46:00+01:00": 225,
    "2026-11-21T08:00:00+01:00": 900, // domani: fuori
  };
  const adesso = new Date("2026-11-20T06:00:00+01:00");
  const ore = orePreviste([wh], adesso);
  assert.equal(ore.length, 6);
  assert.equal(ore[2].inizio.toISOString(), "2026-11-20T11:00:00.000Z"); // la chiave 13:00 è l'ora 12:00-13:00
  assert.equal(calcolaOraLimite({ ore, adesso, sogliaKW: 1.5 }).oraLimite, "14:00");
});

// --- Rapporto dell'ultima ora e previsione per il semaforo delle macchine

import { aggiungiCampione, previsioneMacchine, previstoTra, rapportoUltimaOra, type Campione } from "../src/oralimite.ts";

const campioniOgni10 = (da: string, a_: string, kwhDa: number, kwhOra: number): Campione[] => {
  const t0 = a(da).getTime(), t1 = a(a_).getTime();
  const out: Campione[] = [];
  for (let t = t0; t <= t1; t += 10 * 60_000) out.push({ t, kwh: kwhDa + (kwhOra * (t - t0)) / 3600_000 });
  return out;
};

test("previstoTra prende le ore per la parte che cade nell'intervallo", () => {
  assert.equal(previstoTra(sereno, a("10:30").getTime(), a("11:30").getTime()), 1000 + 1400);
  assert.equal(previstoTra(sereno, a("06:00").getTime(), a("08:00").getTime()), 0);
});

test("rapporto dell'ultima ora: il sole di adesso, non quello della mattina", () => {
  // dalle 10:00 alle 11:00 previsti 2000 Wh, prodotti 2,8 kWh: 1,4
  const c = campioniOgni10("10:00", "11:00", 1.0, 2.8);
  assert.equal(Math.round(rapportoUltimaOra(sereno, c, a("11:00"))! * 100) / 100, 1.4);
  // la mattina intera direbbe altro, ma il recente vince nell'ora limite
  const r = calcolaOraLimite({ ore: sereno, prodottoOggiKWh: 1.0, rapportoRecente: 1.4, adesso: a("11:00"), sogliaKW: 1.5 });
  assert.equal(r.rapporto, 1.4);
});

test("rapporto dell'ultima ora: niente se mancano campioni o sole", () => {
  assert.equal(rapportoUltimaOra(sereno, campioniOgni10("10:30", "11:00", 1, 2), a("11:00")), undefined); // 30 minuti
  assert.equal(rapportoUltimaOra(sereno, campioniOgni10("09:00", "10:00", 1, 2), a("11:00")), undefined); // vecchi
  assert.equal(rapportoUltimaOra(sereno, campioniOgni10("07:00", "08:00", 0, 0.1), a("08:00")), undefined); // alba
  assert.equal(rapportoUltimaOra(sereno, campioniOgni10("10:00", "11:00", 1, 0.2), a("11:00")), 0.5); // limitato
});

test("i campioni restano solo di oggi, delle ultime due ore, e ripartono dopo un azzeramento", () => {
  let c: Campione[] = [];
  c = aggiungiCampione(c, { t: a("08:00").getTime(), kwh: 1 });
  c = aggiungiCampione(c, { t: a("09:00").getTime(), kwh: 2 });
  c = aggiungiCampione(c, { t: a("10:30").getTime(), kwh: 3 });
  assert.deepEqual(c.map((x) => x.kwh), [2, 3]);
  c = aggiungiCampione(c, { t: a("10:40").getTime(), kwh: 0.1 });
  assert.deepEqual(c.map((x) => x.kwh), [0.1]);
});

test("semaforo: sole che resta e ora migliore entro il limite", () => {
  // alle 10:00: restano 2000+2800+3000+2900+2800+1600+700 = 15800 Wh; al 50%: 7,9 kWh
  const p = previsioneMacchine({ ore: sereno, rapporto: 0.5, adesso: a("10:00"), oraLimite: "16:00" });
  assert.equal(p.solePrevistoKWh, 7.9);
  assert.equal(p.oraMigliore, "12:00"); // 3000 contro 2000 adesso
  // alle 12:10 l'ora in corso è la migliore: nessuna attesa
  assert.equal(previsioneMacchine({ ore: sereno, rapporto: 1, adesso: a("12:10"), oraLimite: "16:00" }).oraMigliore, null);
  // un'ora migliore oltre il limite non conta
  assert.equal(previsioneMacchine({ ore: sereno, rapporto: 1, adesso: a("10:00"), oraLimite: "12:00" }).oraMigliore, "11:00");
  assert.equal(previsioneMacchine({ ore: sereno, rapporto: 1, adesso: a("10:00"), oraLimite: "11:00" }).oraMigliore, null);
  // poco meglio (sotto il 15% in più) non vale l'attesa
  const piatto = giorno("2026-11-19", "+01:00", { "10": 2000, "11": 2200, "12": 2100 });
  assert.equal(previsioneMacchine({ ore: piatto, rapporto: 1, adesso: a("10:00"), oraLimite: null }).oraMigliore, null);
});
