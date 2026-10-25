// Importa faccende.yaml in Donetick.
//   node src/cli/importa.ts            crea le faccende che mancano
//   node src/cli/importa.ts --aggiorna aggiorna anche quelle già importate
//   node src/cli/importa.ts --prova    mostra cosa farebbe, senza scrivere

import { leggiMarcatore } from "../donetick.ts";
import { inDonetick } from "../mappa.ts";
import { catalogo, donetickAdmin, idUtenti } from "../servizi.ts";

const prova = process.argv.includes("--prova");
const aggiorna = process.argv.includes("--aggiorna");

const cat = catalogo();
const { client, membri } = await donetickAdmin(cat);
const utenti = idUtenti(cat, membri);
for (const p of cat.persone) {
  if (!utenti.has(p.toLowerCase())) throw new Error(`Nessun utente Donetick con nome "${p}" nella cerchia`);
}

const esistenti = new Map<string, { id: number; updatedAt: string; nextDueDate: string | null }>();
for (const c of await client.faccende(true)) {
  const m = leggiMarcatore(c);
  if (m) esistenti.set(m.persona ? `${m.id}:${m.persona}` : m.id, { id: c.id, updatedAt: c.updatedAt, nextDueDate: c.nextDueDate });
}

const adesso = new Date();
const conteggi = { create: 0, aggiornate: 0, giaPresenti: 0, saltate: 0 };

for (const voce of cat.faccende) {
  if (!voce.importa) continue;
  const persone = voce.chi === "ciascuno" ? cat.persone : [undefined];
  for (const persona of persone) {
    const chiave = persona ? `${voce.id}:${persona.toLowerCase()}` : voce.id;
    const { chore, avvisi } = inDonetick(voce, persona, utenti, cat, adesso);
    for (const a of avvisi) console.warn(`! ${a.id}: ${a.messaggio}`);
    if (!chore.name) {
      conteggi.saltate++;
      continue;
    }
    const esistente = esistenti.get(chiave);
    if (prova) {
      console.log(
        `${esistente ? "=" : "+"} ${String(chore.name).padEnd(60)} ${String(chore.frequencyType).padEnd(17)} ${chore.nextDueDate ?? "-"}`,
      );
      continue;
    }
    if (esistente && !aggiorna) {
      conteggi.giaPresenti++;
    } else if (esistente) {
      // La scadenza in corso resta quella di Donetick: le faccende di oggi non ancora fatte non devono sparire.
      // Se la regola è cambiata, i lavori periodici la portano al giorno giusto.
      await client.modifica({ ...chore, id: esistente.id, updatedAt: esistente.updatedAt, nextDueDate: esistente.nextDueDate ?? chore.nextDueDate });
      conteggi.aggiornate++;
    } else {
      await client.crea(chore);
      conteggi.create++;
    }
  }
}

if (!prova) {
  console.log(
    `Create ${conteggi.create}, aggiornate ${conteggi.aggiornate}, già presenti ${conteggi.giaPresenti}, saltate ${conteggi.saltate}.`,
  );
}
