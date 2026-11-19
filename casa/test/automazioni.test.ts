import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { giorniPiuPieni } from "../src/automazioni.ts";
import { leggiCatalogo } from "../src/catalogo.ts";

const cat = leggiCatalogo(join(import.meta.dirname, "..", "..", "faccende.esempio.yaml"));
const [a, b] = cat.persone;

test("giorni più pieni dopo un cambio", () => {
  const diSolito = { [a]: { mar: 40 }, [b]: { mar: 50, gio: 60 } };
  const adesso = { [a]: { mar: 100 }, [b]: { mar: 50, gio: 30 } };
  assert.deepEqual(giorniPiuPieni(cat, adesso, diSolito), [
    { giorno: "mar", persona: a, minuti: 100, diSolito: 40, altra: b, minutiAltra: 50, daPassare: 25 },
  ]);
});

test("niente da ribilanciare se il carico non cresce o resta sotto l'altra persona", () => {
  assert.deepEqual(giorniPiuPieni(cat, { [a]: { lun: 50 } }, { [a]: { lun: 45 } }), []);
  assert.deepEqual(giorniPiuPieni(cat, { [a]: { lun: 50 }, [b]: { lun: 70 } }, { [a]: { lun: 20 }, [b]: { lun: 70 } }), []);
});
