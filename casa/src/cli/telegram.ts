// Bot Telegram dei promemoria.
//   node src/cli/telegram.ts --chat                          chat che hanno scritto al bot (dopo Start)
//   node src/cli/telegram.ts --prova Anna                    manda un messaggio di prova ad Anna
//   node src/cli/telegram.ts --anteprima Anna mattina|sera|domani   stampa il testo con i dati veri, senza inviarlo

import { config } from "../config.ts";
import { type Slot, SLOT, preparaMessaggio } from "../promemoria.ts";
import { catalogo, donetickAdmin } from "../servizi.ts";
import { inviaMessaggio, ultimiChat } from "../telegram.ts";

const [modo, persona, slot] = process.argv.slice(2);

if (modo === "--chat") {
  const chat = await ultimiChat();
  if (chat.length === 0) console.log("Nessun messaggio ricevuto: chi deve ricevere i promemoria apra il bot e prema Start.");
  for (const c of chat) console.log(`${c.id}\t${c.nome}${c.username ? ` (@${c.username})` : ""}`);
} else if (modo === "--prova") {
  const id = persona ? config.telegram.chat(persona) : undefined;
  if (!id) throw new Error(`Manca TELEGRAM_CHAT_${(persona ?? "<PERSONA>").toUpperCase()}`);
  await inviaMessaggio(id, `Ciao ${persona}, sono Casa. Da oggi ti scrivo qui le faccende: alle 9:00 quelle di oggi, alle 18:00 quelle che restano, alle 22:00 il memo di domani.`);
  console.log("Messaggio di prova inviato.");
} else if (modo === "--anteprima") {
  if (!persona || !(slot in SLOT)) throw new Error("Uso: --anteprima <persona> mattina|sera|domani");
  const cat = catalogo();
  const { client, membri } = await donetickAdmin(cat);
  const testo = await preparaMessaggio(client, cat, membri, persona, slot as Slot, new Date());
  console.log(testo ?? "(niente da dire: il messaggio non partirebbe)");
} else {
  console.error("Uso: --chat | --prova <persona> | --anteprima <persona> <slot>");
  process.exit(1);
}
