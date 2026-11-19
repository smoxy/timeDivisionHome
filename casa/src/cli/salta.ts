// Salta un giorno di una voce, per tutti (palestra annullata, ospiti, ...).
//   node src/cli/salta.ts palestra-gio 2026-11-05
//   node src/cli/salta.ts palestra-gio 2026-11-05 --ripristina

import { occorrenzeDelGiorno } from "../calendario.ts";
import { config } from "../config.ts";
import { leggiMarcatore } from "../donetick.ts";
import { eseguiLavori } from "../lavori.ts";
import { catalogo, donetickAdmin } from "../servizi.ts";
import { leggiStato, scriviStato } from "../stato.ts";
import { leggiGiorno } from "../tempo.ts";

const [id, data] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const ripristina = process.argv.includes("--ripristina");
if (!id || !data) {
  console.error("Uso: node src/cli/salta.ts <id voce> <AAAA-MM-GG> [--ripristina]");
  process.exit(1);
}

let cat = catalogo();
const voce = cat.faccende.find((v) => v.id === id);
if (!voce) throw new Error(`Nessuna voce "${id}" in faccende.yaml`);
const giorno = leggiGiorno(data);

const stato = leggiStato(config.stato);
const date = new Set(stato.saltate[id] ?? []);
if (ripristina) date.delete(data);
else date.add(data);
if (date.size > 0) stato.saltate[id] = [...date].sort();
else delete stato.saltate[id];
scriviStato(config.stato, stato);
cat = catalogo();

const { client } = await donetickAdmin(cat);
if (ripristina) {
  // La faccenda in Donetick è già passata al giorno dopo: la si riporta al giorno ripristinato
  const o = occorrenzeDelGiorno(voce, giorno, cat)[0];
  const c = (await client.faccende(false)).find((x) => leggiMarcatore(x)?.id === id);
  if (o && c && o.quando > new Date()) await client.spostaScadenza(c.id, o.quando);
  console.log(`${id}: il ${data} torna in calendario`);
} else {
  for (const e of await eseguiLavori(client, cat, new Date(), config.stato)) console.log(`${e.faccenda}: ${e.azione}`);
  console.log(`${id}: il ${data} è saltato per tutti`);
}
