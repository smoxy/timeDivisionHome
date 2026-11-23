import assert from "node:assert/strict";
import { test } from "node:test";
import { preparaSpinta, type Spinta } from "../src/limiteha.ts";
import type { OraLimite } from "../src/oralimite.ts";

const a = (h: string, g = "2026-11-19") => new Date(`${g}T${h}:00+01:00`);
const prev = (oraLimite: string): OraLimite => ({ oraLimite, motivo: "previsione", rapporto: 1 });

test("prima scrittura: data e ora di oggi e motivo", () => {
  assert.deepEqual(preparaSpinta(prev("16:00"), a("08:00"), null), {
    giorno: "2026-11-19",
    datetime: "2026-11-19 16:00:00",
    motivo: "previsione",
  });
});

test("invariato: niente da scrivere (il rapporto non conta)", () => {
  const u = preparaSpinta(prev("16:00"), a("08:00"), null)!;
  assert.equal(preparaSpinta({ ...prev("16:00"), rapporto: 0.8 }, a("09:00"), u), null);
});

test("cambia l'ora: si riscrive", () => {
  const u = preparaSpinta(prev("16:00"), a("08:00"), null)!;
  assert.equal(preparaSpinta(prev("15:00"), a("11:00"), u)?.datetime, "2026-11-19 15:00:00");
});

test("poco sole: mezzanotte di oggi e motivo", () => {
  const r: OraLimite = { oraLimite: null, motivo: "poco sole", rapporto: 0.5 };
  assert.deepEqual(preparaSpinta(r, a("10:00"), preparaSpinta(prev("16:00"), a("08:00"), null)), {
    giorno: "2026-11-19",
    datetime: "2026-11-19 00:00:00",
    motivo: "poco sole",
  });
});

test("nuovo giorno: si riscrive anche se l'ora è la stessa", () => {
  const u = preparaSpinta(prev("16:00"), a("08:00"), null)!;
  assert.equal(preparaSpinta(prev("16:00"), a("08:00", "2026-11-20"), u)?.datetime, "2026-11-20 16:00:00");
});

test("senza previsione passeggero non cancella un valore buono di oggi", () => {
  const u = preparaSpinta(prev("16:00"), a("08:00"), null)!;
  const senza: OraLimite = { oraLimite: null, motivo: "senza previsione" };
  assert.equal(preparaSpinta(senza, a("12:00"), u), null);
});

test("senza previsione si scrive se è il primo valore di oggi o viene da ieri", () => {
  const senza: OraLimite = { oraLimite: null, motivo: "senza previsione" };
  assert.equal(preparaSpinta(senza, a("08:00"), null)?.motivo, "senza previsione");
  const ieri: Spinta = { giorno: "2026-11-18", datetime: "2026-11-18 16:00:00", motivo: "previsione" };
  assert.equal(preparaSpinta(senza, a("00:05"), ieri)?.datetime, "2026-11-19 00:00:00");
});

test("dopo la scrittura di senza previsione, la previsione tornata si scrive", () => {
  const senza: OraLimite = { oraLimite: null, motivo: "senza previsione" };
  const u = preparaSpinta(senza, a("08:00"), null)!;
  assert.equal(preparaSpinta(prev("16:00"), a("08:10"), u)?.motivo, "previsione");
});

import { preparaSemaforo } from "../src/limiteha.ts";

test("semaforo: si scrive subito, poi solo se cambia o dopo 10 minuti", () => {
  const r: OraLimite = { oraLimite: "15:00", motivo: "previsione", rapporto: 1.234, solePrevistoKWh: 7.9, oraMigliore: "12:00" };
  const u = preparaSemaforo(r, a("10:00"), null)!;
  assert.deepEqual({ ...u, scritto: 0 }, { soleKWh: 7.9, oraMigliore: "12:00", rapporto: 1.23, scritto: 0 });
  assert.equal(preparaSemaforo(r, a("10:05"), u), null);
  assert.notEqual(preparaSemaforo({ ...r, oraMigliore: null }, a("10:05"), u), null);
  assert.equal(preparaSemaforo({ ...r, oraMigliore: null }, a("10:05"), u)?.oraMigliore, "");
  assert.notEqual(preparaSemaforo(r, a("10:11"), u), null);
  assert.equal(preparaSemaforo({ oraLimite: null, motivo: "senza previsione" }, a("10:05"), null), null);
});
