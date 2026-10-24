import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { leggiCatalogo } from "../src/catalogo.ts";
import { occorrenze, prossima, settimanaAB } from "../src/calendario.ts";
import { sabatoCorrenteOProssimo, tramonto } from "../src/sole.ts";
import { isoGiorno, leggiGiorno, oraLocale } from "../src/tempo.ts";

// I test usano il catalogo di esempio, che sta nel repository; quello vero di casa no.
const cat = leggiCatalogo(join(import.meta.dirname, "..", "..", "faccende.esempio.yaml"));
const voce = (id: string) => cat.faccende.find((f) => f.id === id)!;

test("tramonti di Roma", () => {
  assert.equal(oraLocale(tramonto(leggiGiorno("2026-12-11"), cat.luogo)), "16:39");
  assert.equal(oraLocale(tramonto(leggiGiorno("2026-10-30"), cat.luogo)), "17:08");
  assert.equal(oraLocale(tramonto(leggiGiorno("2027-06-25"), cat.luogo)), "20:49");
});

test("finestra del sabato", () => {
  const f = sabatoCorrenteOProssimo(new Date("2026-11-13T12:00:00Z"), cat.luogo);
  assert.equal(isoGiorno(f.venerdi), "2026-11-13");
  assert.equal(oraLocale(f.inizio), "16:52");
  assert.equal(oraLocale(f.fine), "16:51");
  const dopo = sabatoCorrenteOProssimo(new Date("2026-11-14T18:00:00Z"), cat.luogo);
  assert.equal(isoGiorno(dopo.venerdi), "2026-11-20");
});

test("settimana A parte da domenica 25 ottobre", () => {
  assert.equal(settimanaAB(leggiGiorno("2026-10-25"), cat.settimanaA), "A");
  assert.equal(settimanaAB(leggiGiorno("2026-10-31"), cat.settimanaA), "A");
  assert.equal(settimanaAB(leggiGiorno("2026-11-01"), cat.settimanaA), "B");
  assert.equal(settimanaAB(leggiGiorno("2026-11-08"), cat.settimanaA), "A");
});

test("cadenze mensili e mesi pari o dispari", () => {
  const dopo = new Date("2026-10-24T12:00:00Z");
  // 1° lunedì del mese
  assert.equal(isoGiorno(dateOf(prossima(voce("bollette"), dopo, cat)!.quando)), "2026-11-02");
  // ultimo giovedì
  assert.equal(isoGiorno(dateOf(prossima(voce("scadenze-cibo"), dopo, cat)!.quando)), "2026-10-29");
  // 1° giovedì dei mesi dispari: novembre
  assert.equal(isoGiorno(dateOf(prossima(voce("frigo"), dopo, cat)!.quando)), "2026-11-05");
  // 1° lunedì dei mesi pari: dicembre
  assert.equal(isoGiorno(dateOf(prossima(voce("davanzali"), dopo, cat)!.quando)), "2026-12-07");
  // 2° martedì dei mesi pari
  assert.equal(isoGiorno(dateOf(prossima(voce("ciclo-cura-lavastoviglie"), dopo, cat)!.quando)), "2026-12-08");
  // ogni 3 mesi, 1ª domenica di nov, feb, mag, ago
  assert.equal(isoGiorno(dateOf(prossima(voce("portico-lavare"), dopo, cat)!.quando)), "2026-11-01");
});

test("stagioni legate al tramonto del venerdì", () => {
  const giorni = (da: string, a: string, id: string) =>
    occorrenze(cat, leggiGiorno(da), leggiGiorno(a)).filter((o) => o.voce.id === id).map((o) => isoGiorno(dateOf(o.quando)));
  // a dicembre i pavimenti di sotto si lavano la domenica, non il venerdì sera
  assert.deepEqual(giorni("2026-12-06", "2026-12-12", "lavare-sotto"), ["2026-12-06"]);
  assert.deepEqual(giorni("2026-12-06", "2026-12-12", "prep-sabato-sera"), []);
  // a marzo il contrario
  assert.deepEqual(giorni("2027-03-07", "2027-03-13", "lavare-sotto"), []);
  assert.deepEqual(giorni("2027-03-07", "2027-03-13", "prep-sabato-sera"), ["2027-03-12"]);
});

test("niente cade durante il sabato", () => {
  const tutte = occorrenze(cat, leggiGiorno("2026-10-25"), leggiGiorno("2027-10-30"));
  for (const o of tutte) {
    const f = sabatoCorrenteOProssimo(o.quando, cat.luogo);
    assert.ok(!(o.quando >= f.inizio && o.quando < f.fine), `${o.voce.id} il ${o.quando.toISOString()}`);
  }
  // d'estate la cena del sabato slitta a mezz'ora dopo il tramonto
  const cena = occorrenze(cat, leggiGiorno("2027-06-26"), leggiGiorno("2027-06-26")).find((o) => o.voce.id === "cena-sabato")!;
  assert.equal(cena.spostataDalSabato, true);
  assert.equal(oraLocale(cena.quando), "21:19");
});

test("il concetto è l'id della voce, salvo diverso avviso", () => {
  assert.equal(voce("letto").concetto, "letto");
  assert.equal(voce("lavare-sotto").concetto, "lavare-sotto");
  assert.equal(voce("prep-sabato-sera").concetto, "lavare-sotto");
});

test("ciascuno vale per tutte le persone", () => {
  const letti = occorrenze(cat, leggiGiorno("2026-10-26"), leggiGiorno("2026-10-26")).filter((o) => o.voce.id === "letto");
  assert.deepEqual(letti.map((o) => o.chi).sort(), ["Anna", "Luca"]);
});

function dateOf(t: Date) {
  const s = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(t);
  return leggiGiorno(s);
}

test("hash delle password senza $ e compatibile con il formato vecchio", async () => {
  const { hashPassword, verificaPassword } = await import("../src/accesso.ts");
  const h = hashPassword("una password di prova");
  assert.ok(!h.includes("$"));
  assert.ok(verificaPassword("una password di prova", h));
  assert.ok(!verificaPassword("sbagliata", h));
  assert.ok(verificaPassword("una password di prova", h.replaceAll(":", "$")));
});
