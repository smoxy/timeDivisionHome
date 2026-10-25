import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { leggiCatalogo } from "../src/catalogo.ts";
import { occorrenze, prossima, settimanaAB } from "../src/calendario.ts";
import { sabatoCorrenteOProssimo, tramonto } from "../src/sole.ts";
import { isoGiorno, istanteLocale, leggiGiorno, oraLocale } from "../src/tempo.ts";

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

test("umido legato ai giorni in sede, predefiniti e cambiati", async () => {
  const { leggiCatalogo: leggi } = await import("../src/catalogo.ts");
  const c = leggi(join(import.meta.dirname, "..", "..", "faccende.esempio.yaml"));
  const chi = (g: string) =>
    occorrenze(c, leggiGiorno(g), leggiGiorno(g)).filter((o) => o.voce.concetto === "umido").map((o) => o.chi);
  // settimana dal 1 novembre: predefiniti lunedì e mercoledì
  assert.deepEqual(chi("2026-11-02"), ["Anna"]);
  assert.deepEqual(chi("2026-11-03"), ["Luca"]);
  assert.deepEqual(chi("2026-11-04"), ["Anna"]);
  // in sede martedì e giovedì solo quella settimana
  c.sedeDellaSettimana = (d) => (isoGiorno(d) === "2026-11-01" ? ["mar", "gio"] : c.sedePredefinita);
  assert.deepEqual(chi("2026-11-02"), ["Luca"]);
  assert.deepEqual(chi("2026-11-03"), ["Anna"]);
  assert.deepEqual(chi("2026-11-05"), ["Anna"]);
  assert.deepEqual(chi("2026-11-09"), ["Anna"]); // la settimana dopo torna come prima
  // ogni giorno qualcuno butta l'umido, e mai tutti e due
  for (const g of ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"]) {
    assert.equal(chi(g).length, 1, g);
  }
});

test("abbinamento dei giorni in sede che cambiano", async () => {
  const { abbinaGiorni } = await import("../src/lavori.ts");
  assert.deepEqual(abbinaGiorni(["lun", "mer"], ["mar", "gio"]), [
    { lascia: "lun", prende: "mar" },
    { lascia: "mer", prende: "gio" },
  ]);
  assert.deepEqual(abbinaGiorni(["lun", "mer"], ["lun", "ven"]), [{ lascia: "mer", prende: "ven" }]);
  assert.deepEqual(abbinaGiorni(["lun", "mer"], ["lun", "mer"]), []);
});

test("vincoli per le proposte dell'assistente", async () => {
  const { impedimento } = await import("../src/automazioni.ts");
  const ora = (g: string, h: number, m = 0) => istanteLocale(leggiGiorno(g), h, m);
  assert.match(impedimento("Luca", ora("2026-11-02", 10), cat)!, /in sede/); // lunedì in sede
  assert.equal(impedimento("Luca", ora("2026-11-02", 20, 30), cat), null); // la sera è a casa
  assert.match(impedimento("Anna", ora("2026-11-02", 9), cat)!, /impegno/); // università
  assert.match(impedimento("Luca", ora("2026-11-07", 11), cat)!, /sabato/);
  assert.equal(impedimento("Anna", ora("2026-11-03", 10), cat), null);
});
