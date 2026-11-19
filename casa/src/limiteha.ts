// Casa scrive in Home Assistant l'ora limite delle macchine di oggi (input_datetime + input_text),
// così i sensori e le automazioni di Home Assistant non devono interrogare Casa.

import { config } from "./config.ts";
import type { HomeAssistant } from "./homeassistant.ts";
import { leggiOraLimite, type OraLimite } from "./oralimite.ts";
import { giornoDi, isoGiorno } from "./tempo.ts";

export type Spinta = { giorno: string; datetime: string; motivo: OraLimite["motivo"] };

// Cosa scrivere in Home Assistant, o null se non è cambiato niente dall'ultima scrittura.
// Senza ora limite l'input_datetime va a mezzanotte di oggi (il template lo ignora: conta il motivo).
// Un "senza previsione" passeggero (websocket giù) non cancella un valore buono già scritto oggi.
export function preparaSpinta(r: OraLimite, adesso: Date, ultima: Spinta | null): Spinta | null {
  const giorno = isoGiorno(giornoDi(adesso));
  const spinta: Spinta = { giorno, datetime: `${giorno} ${r.oraLimite ?? "00:00"}:00`, motivo: r.motivo };
  if (ultima && ultima.giorno === giorno) {
    if (r.motivo === "senza previsione" && ultima.motivo !== "senza previsione") return null;
    if (ultima.datetime === spinta.datetime && ultima.motivo === spinta.motivo) return null;
  }
  return spinta;
}

let ultima: Spinta | null = null;

// Da chiamare a ogni giro dei lavori: scrive solo quando il valore cambia. Gli errori si registrano
// e non fermano niente: se la scrittura non è riuscita al giro dopo si riprova.
export async function pubblicaOraLimite(ha: HomeAssistant | null, sogliaKW?: number, adesso = new Date()): Promise<void> {
  const { oraLimite: entita, motivoOraLimite: entitaMotivo } = config.ha;
  if (!ha || !entita || !entitaMotivo) return;
  try {
    const spinta = preparaSpinta(await leggiOraLimite(adesso, sogliaKW), adesso, ultima);
    if (!spinta) return;
    const scriviOra = () => ha.servizio("input_datetime", "set_datetime", { entity_id: entita, datetime: spinta.datetime });
    const scriviMotivo = () => ha.servizio("input_text", "set_value", { entity_id: entitaMotivo, value: spinta.motivo });
    // Le due scritture non sono atomiche: il primo giorno il motivo va per primo, così non si abbina
    // alla data nuova il motivo di ieri (la data vecchia, invece, il template la ignora)
    if (ultima?.giorno === spinta.giorno) {
      await scriviOra();
      await scriviMotivo();
    } else {
      await scriviMotivo();
      await scriviOra();
    }
    ultima = spinta;
    console.log(`[ora limite] ${spinta.datetime} (${spinta.motivo}) scritta in Home Assistant`);
  } catch (e) {
    console.error("[ora limite]", (e as Error).message);
  }
}
