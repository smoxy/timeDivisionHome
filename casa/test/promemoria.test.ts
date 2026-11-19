import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { leggiCatalogo } from "../src/catalogo.ts";
import { costruisciMessaggio, durata, slotDovuti, type VoceAperta } from "../src/promemoria.ts";
import { istanteLocale, leggiGiorno } from "../src/tempo.ts";

const cat = leggiCatalogo(join(import.meta.dirname, "..", "..", "faccende.esempio.yaml"));
const giorno = (g: string, h: number, m = 0) => istanteLocale(leggiGiorno(g), h, m);
const voce = (id: string, quando: Date, minuti: number, extra: Partial<VoceAperta> = {}): VoceAperta => ({
  id,
  nome: id,
  quando,
  minuti,
  concetto: id,
  conAltri: false,
  ...extra,
});

test("durate leggibili", () => {
  assert.equal(durata(25), "25 min");
  assert.equal(durata(120), "2 h");
  assert.equal(durata(190), "3 h 10 min");
});

test("mattina: oggi in ordine, con le rimaste da prima a parte", () => {
  const adesso = giorno("2026-11-05", 9);
  const testo = costruisciMessaggio(
    {
      slot: "mattina",
      persona: "Anna",
      adesso,
      aperte: [
        voce("pulire", giorno("2026-11-05", 14), 10),
        voce("bucato", giorno("2026-11-05", 8, 30), 45),
        voce("palestra", giorno("2026-11-05", 10, 10), 140, { conAltri: true }),
        voce("camera", giorno("2026-11-04", 8), 10),
        voce("domani", giorno("2026-11-06", 8), 10), // non è di oggi
      ],
      previsteDomani: [],
    },
    cat,
  )!;
  const righe = testo.split("\n");
  assert.match(righe[0], /^Buongiorno Anna! Oggi, giovedì 5 novembre:$/);
  assert.deepEqual(righe.filter((r) => r.startsWith("•")).slice(0, 3), [
    "• 08:30 bucato (45 min)",
    "• 10:10 palestra (2 h 20 min) - con Luca",
    "• 14:00 pulire (10 min)",
  ]);
  assert.match(testo, /In tutto circa 3 h 15 min\./);
  assert.match(testo, /Rimaste da prima:\n• mer 4 08:00 camera \(10 min\)$/);
  assert.ok(!testo.includes("domani"));
});

test("mattina senza niente: nessun messaggio", () => {
  assert.equal(costruisciMessaggio({ slot: "mattina", persona: "Anna", adesso: giorno("2026-11-05", 9), aperte: [voce("x", giorno("2026-11-06", 8), 5)], previsteDomani: [] }, cat), null);
});

test("sera: in ritardo e ancora oggi", () => {
  const testo = costruisciMessaggio(
    {
      slot: "sera",
      persona: "Anna",
      adesso: giorno("2026-11-05", 18),
      aperte: [voce("frigo", giorno("2026-11-05", 17, 30), 40), voce("cena", giorno("2026-11-05", 19, 45), 45), voce("umido", giorno("2026-11-05", 21, 30), 3), voce("dopo", giorno("2026-11-06", 7), 5)],
      previsteDomani: [],
    },
    cat,
  )!;
  assert.match(testo, /Ancora da fare \(in ritardo\):\n• 17:30 frigo \(40 min\)\n\nAncora oggi:\n• 19:45 cena \(45 min\)\n• 21:30 umido \(3 min\)/);
  assert.match(testo, /In tutto circa 1 h 28 min\./);
  assert.ok(!testo.includes("dopo"));
});

test("domani: le voci di Donetick, quelle previste non ancora datate, e il sospeso di oggi senza doppioni", () => {
  const testo = costruisciMessaggio(
    {
      slot: "domani",
      persona: "Anna",
      adesso: giorno("2026-11-05", 22),
      aperte: [
        voce("letto", giorno("2026-11-06", 7, 30), 5), // già datato domani in Donetick
        voce("camera", giorno("2026-11-05", 8), 10), // di oggi, non spuntata
      ],
      previsteDomani: [
        voce("letto", giorno("2026-11-06", 7, 30), 5), // stessa voce: non si ripete
        voce("camera", giorno("2026-11-06", 8), 10), // stessa cosa ancora aperta: resta tra quelle di oggi
        voce("vetri", giorno("2026-11-06", 17, 30), 45), // prevista, Donetick non la data ancora
      ],
    },
    cat,
  )!;
  assert.match(testo, /memo per domani, venerdì 6 novembre:\n\n• 07:30 letto \(5 min\)\n• 17:30 vetri \(45 min\)\n\nIn tutto circa 50 min\./);
  assert.match(testo, /Di oggi è rimasto aperto:\n• 08:00 camera \(10 min\)$/);
  assert.equal(testo.split("camera").length - 1, 1);
});

test("slot dovuti: solo dopo l'ora, fino a 90 minuti di recupero, mai due volte", () => {
  const dovuti = (adesso: Date, gestiti: Record<string, string> = {}) => slotDovuti(adesso, cat, "Anna", gestiti).map((d) => d.slot);
  assert.deepEqual(dovuti(giorno("2026-11-05", 8, 59)), []);
  assert.deepEqual(dovuti(giorno("2026-11-05", 9)), ["mattina"]);
  assert.deepEqual(dovuti(giorno("2026-11-05", 10, 30)), ["mattina"]);
  assert.deepEqual(dovuti(giorno("2026-11-05", 10, 31)), []); // oltre il recupero
  assert.deepEqual(dovuti(giorno("2026-11-05", 18, 5)), ["sera"]);
  assert.deepEqual(dovuti(giorno("2026-11-05", 22, 1)), ["domani"]);
  assert.deepEqual(dovuti(giorno("2026-11-05", 9, 5), { "2026-11-05|Anna|mattina": "2026-11-05T08:00:00.000Z" }), []);
  assert.deepEqual(dovuti(giorno("2026-11-05", 9, 5), { "2026-11-05|Luca|mattina": "x" }), ["mattina"]); // è di un'altra persona
});

test("nel sabato i promemoria si saltano", () => {
  const sabato = (g: string, h: number) => slotDovuti(giorno(g, h, 1), cat, "Anna", {}).map((d) => `${d.slot}:${d.sabato}`);
  assert.deepEqual(sabato("2026-11-06", 22), ["domani:true"]); // venerdì sera, dopo il tramonto
  assert.deepEqual(sabato("2026-11-07", 9), ["mattina:true"]);
  assert.deepEqual(sabato("2026-11-07", 18), ["sera:false"]); // il tramonto è prima delle 17:15
  assert.deepEqual(sabato("2026-11-06", 9), ["mattina:false"]); // venerdì mattina
});

test("le cose rimaste indietro si limitano alle più recenti", () => {
  const vecchie = Array.from({ length: 9 }, (_, i) => voce(`v${i}`, giorno(`2026-10-${String(20 + i).padStart(2, "0")}`, 10), 5));
  const testo = costruisciMessaggio({ slot: "mattina", persona: "Anna", adesso: giorno("2026-11-05", 9), aperte: vecchie, previsteDomani: [] }, cat)!;
  assert.equal(testo.split("\n").filter((r) => r.startsWith("•")).length, 6);
  assert.match(testo, /…e altre 3 più vecchie, le trovi in Casa\./);
  assert.ok(testo.includes("v8") && !testo.includes("v0"));
});
