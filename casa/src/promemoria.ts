// Promemoria su Telegram: tre messaggi al giorno a chi ha una chat configurata.
//   mattina (9:00)  cosa c'è da fare oggi, e le rimaste da ieri
//   sera (18:00)    cosa non è ancora stato fatto e cosa resta della giornata
//   domani (22:00)  il memo del giorno dopo, più quello che di oggi è rimasto aperto
// Lo stato vero (fatto o no) è quello di Donetick; per domani si aggiungono le voci che la settimana
// di Casa prevede e che Donetick non ha ancora datato, perché la faccenda di oggi non è stata spuntata.
// Niente parte nel sabato: né il messaggio né un recupero dopo.

import type { Catalogo } from "./catalogo.ts";
import { config } from "./config.ts";
import { type Donetick, type DonetickChore, leggiMarcatore, type Membro } from "./donetick.ts";
import { settimanaDi } from "./settimana.ts";
import { nelSabato } from "./sole.ts";
import { leggiStato, scriviStato } from "./stato.ts";
import { utenteDi } from "./servizi.ts";
import { inviaMessaggio } from "./telegram.ts";
import { domenicaDi, FUSO, type Giorno, giornoDi, isoGiorno, istanteLocale, leggiGiorno, oraLocale, sommaGiorni } from "./tempo.ts";

export type Slot = "mattina" | "sera" | "domani";
export const SLOT: Record<Slot, { ore: number; minuti: number }> = {
  mattina: { ore: 9, minuti: 0 },
  sera: { ore: 18, minuti: 0 },
  domani: { ore: 22, minuti: 0 },
};
// Se Casa era ferma all'ora del messaggio lo recupera fino a questo ritardo, poi lo salta
export const RECUPERO_MS = 90 * 60_000;

export type VoceAperta = {
  id: string;
  nome: string;
  quando: Date;
  minuti: number;
  concetto: string;
  conAltri: boolean; // da fare insieme
};

// Le faccende ancora aperte di una persona in Donetick: sue o da fare insieme, con la prossima scadenza
export async function faccendeAperte(client: Donetick, cat: Catalogo, membri: Membro[], persona: string): Promise<VoceAperta[]> {
  const idPersona = utenteDi(persona, membri)?.userId;
  if (idPersona === undefined) throw new Error(`Nessun utente Donetick per ${persona}`);
  const voci = new Map(cat.faccende.map((v) => [v.id, v]));
  const aperte: VoceAperta[] = [];
  for (const c of await client.faccende(false)) {
    if (!c.isActive || !c.nextDueDate || !dellaPersona(c, idPersona)) continue;
    const id = leggiMarcatore(c)?.id ?? "";
    const voce = voci.get(id);
    aperte.push({
      id,
      nome: voce?.nome ?? c.name,
      quando: new Date(c.nextDueDate),
      minuti: voce?.minuti ?? 0,
      concetto: voce?.concetto ?? id,
      conAltri: c.assignedTo == null,
    });
  }
  return aperte;
}

function dellaPersona(c: DonetickChore, idPersona: number): boolean {
  return c.assignedTo === idPersona || (c.assignedTo == null && c.assignees.some((a) => a.userId === idPersona));
}

// ---- Testi (funzioni pure) ----------------------------------------------------------------

const GIORNO_LUNGO = new Intl.DateTimeFormat("it-IT", { weekday: "long", day: "numeric", month: "long", timeZone: FUSO });
const GIORNO_BREVE = new Intl.DateTimeFormat("it-IT", { weekday: "short", day: "numeric", timeZone: FUSO });

export function durata(minuti: number): string {
  if (minuti < 60) return `${minuti} min`;
  const m = minuti % 60;
  return m === 0 ? `${minuti / 60} h` : `${Math.floor(minuti / 60)} h ${m} min`;
}

function riga(v: VoceAperta, cat: Catalogo, persona: string, conGiorno: boolean): string {
  const altro = cat.persone.filter((p) => p !== persona).join(" e ");
  const quando = conGiorno ? `${GIORNO_BREVE.format(v.quando)} ${oraLocale(v.quando)}` : oraLocale(v.quando);
  return `• ${quando} ${v.nome}${v.minuti ? ` (${durata(v.minuti)})` : ""}${v.conAltri && altro ? ` - con ${altro}` : ""}`;
}

function elenco(voci: VoceAperta[], cat: Catalogo, persona: string, conGiorno = false): string {
  const ordinate = [...voci].sort((a, b) => a.quando.getTime() - b.quando.getTime());
  return ordinate.map((v) => riga(v, cat, persona, conGiorno)).join("\n");
}

// Le cose rimaste indietro possono essere tante: se ne mostrano le più recenti e si dice quante mancano
const MASSIMO_INDIETRO = 6;

function sezione(titolo: string, voci: VoceAperta[], cat: Catalogo, persona: string, conGiorno = false): string | null {
  if (voci.length === 0) return null;
  return `${titolo}\n${elenco(voci, cat, persona, conGiorno)}`;
}

function sezioneIndietro(titolo: string, voci: VoceAperta[], cat: Catalogo, persona: string, inizioOggi: Date): string | null {
  if (voci.length === 0) return null;
  const recenti = [...voci].sort((a, b) => b.quando.getTime() - a.quando.getTime()).slice(0, MASSIMO_INDIETRO);
  const altre = voci.length - recenti.length;
  return `${titolo}\n${elenco(recenti, cat, persona, recenti.some((v) => v.quando < inizioOggi))}${altre > 0 ? `\n…e altre ${altre} più vecchie, le trovi in Casa.` : ""}`;
}

const totale = (voci: VoceAperta[]) => voci.reduce((somma, v) => somma + v.minuti, 0);

export type DatiMessaggio = {
  slot: Slot;
  persona: string;
  adesso: Date;
  aperte: VoceAperta[]; // Donetick: ancora aperte, di qualunque giorno
  previsteDomani: VoceAperta[]; // dalla settimana di Casa, per domani
};

// Il testo di un promemoria, o null se non c'è niente da dire
export function costruisciMessaggio(d: DatiMessaggio, cat: Catalogo): string | null {
  const oggi = giornoDi(d.adesso);
  const inizioOggi = istanteLocale(oggi);
  const inizioDomani = istanteLocale(sommaGiorni(oggi, 1));
  const inizioDopodomani = istanteLocale(sommaGiorni(oggi, 2));
  const prima = (v: VoceAperta, t: Date) => v.quando < t;
  const arretrate = d.aperte.filter((v) => prima(v, inizioOggi));
  const diOggi = d.aperte.filter((v) => !prima(v, inizioOggi) && prima(v, inizioDomani));
  const nome = d.persona;
  const parti: (string | null)[] = [];

  if (d.slot === "mattina") {
    if (arretrate.length + diOggi.length === 0) return null;
    parti.push(`Buongiorno ${nome}! Oggi, ${GIORNO_LUNGO.format(d.adesso)}:`);
    parti.push(diOggi.length > 0 ? elenco(diOggi, cat, nome) : "Per oggi non c'è niente in programma.");
    if (diOggi.length > 0) parti.push(`In tutto circa ${durata(totale(diOggi))}.`);
    parti.push(sezioneIndietro("Rimaste da prima:", arretrate, cat, nome, inizioOggi));
  } else if (d.slot === "sera") {
    const inRitardo = d.aperte.filter((v) => prima(v, d.adesso));
    const ancoraOggi = d.aperte.filter((v) => !prima(v, d.adesso) && prima(v, inizioDomani));
    if (inRitardo.length + ancoraOggi.length === 0) return null;
    parti.push(`${nome}, sono le ${oraLocale(d.adesso)}. Questo è quello che resta.`);
    parti.push(sezioneIndietro("Ancora da fare (in ritardo):", inRitardo, cat, nome, inizioOggi));
    parti.push(sezione("Ancora oggi:", ancoraOggi, cat, nome));
    parti.push(`In tutto circa ${durata(totale([...inRitardo, ...ancoraOggi]))}.`);
  } else {
    const domani = d.aperte.filter((v) => !prima(v, inizioDomani) && prima(v, inizioDopodomani));
    // Una cosa già aperta in Donetick (anche di oggi, non spuntata) non si ripete tra quelle di domani
    const concettiAperti = new Set(d.aperte.filter((v) => prima(v, inizioDopodomani)).map((v) => v.concetto));
    const idAperti = new Set(d.aperte.filter((v) => prima(v, inizioDopodomani)).map((v) => v.id));
    const previste = d.previsteDomani.filter((v) => !concettiAperti.has(v.concetto) && !idAperti.has(v.id));
    const sospeso = [...arretrate, ...diOggi];
    if (domani.length + previste.length + sospeso.length === 0) return null;
    const tutteDomani = [...domani, ...previste];
    parti.push(`${nome}, memo per domani, ${GIORNO_LUNGO.format(istanteLocale(sommaGiorni(oggi, 1), 12))}:`);
    parti.push(tutteDomani.length > 0 ? elenco(tutteDomani, cat, nome) : "Domani non c'è niente in programma.");
    if (tutteDomani.length > 0) parti.push(`In tutto circa ${durata(totale(tutteDomani))}.`);
    parti.push(sezioneIndietro("Di oggi è rimasto aperto:", sospeso, cat, nome, inizioOggi));
  }
  return parti.filter((p): p is string => p !== null).join("\n\n");
}

// ---- Quando parte cosa ----------------------------------------------------------------------

export type SlotDovuto = { slot: Slot; chiave: string; ora: Date; sabato: boolean };

// Gli slot di oggi che si possono ancora mandare: ora passata da non più di RECUPERO_MS e non già gestiti
export function slotDovuti(adesso: Date, cat: Catalogo, persona: string, gestiti: Record<string, string>): SlotDovuto[] {
  const oggi = giornoDi(adesso);
  const dovuti: SlotDovuto[] = [];
  for (const slot of Object.keys(SLOT) as Slot[]) {
    const ora = istanteLocale(oggi, SLOT[slot].ore, SLOT[slot].minuti);
    const ritardo = adesso.getTime() - ora.getTime();
    const chiave = `${isoGiorno(oggi)}|${persona}|${slot}`;
    if (ritardo < 0 || ritardo > RECUPERO_MS || gestiti[chiave]) continue;
    dovuti.push({ slot, chiave, ora, sabato: nelSabato(ora, cat.luogo) !== null });
  }
  return dovuti;
}

// Cosa la settimana di Casa prevede per domani per una persona (sue o da fare insieme)
export function previsteDomani(cat: Catalogo, persona: string, adesso: Date): VoceAperta[] {
  const domani: Giorno = sommaGiorni(giornoDi(adesso), 1);
  return settimanaDi(cat, domenicaDi(domani))
    .voci.filter((v) => v.giorno === isoGiorno(domani) && (v.chi === persona || v.chi === "insieme"))
    .map((v) => {
      const [ore, minuti] = v.ora.split(":").map(Number);
      return {
        id: v.id,
        nome: v.nome,
        quando: istanteLocale(leggiGiorno(v.giorno), ore, minuti),
        minuti: v.minuti,
        concetto: v.concetto,
        conAltri: v.chi === "insieme",
      };
    });
}

export async function preparaMessaggio(
  client: Donetick,
  cat: Catalogo,
  membri: Membro[],
  persona: string,
  slot: Slot,
  adesso: Date,
): Promise<string | null> {
  const aperte = await faccendeAperte(client, cat, membri, persona);
  return costruisciMessaggio({ slot, persona, adesso, aperte, previsteDomani: slot === "domani" ? previsteDomani(cat, persona, adesso) : [] }, cat);
}

// Chiamata a ogni giro dei lavori: manda i promemoria dovuti e ricorda cosa ha già gestito
export async function inviaPromemoria(client: Donetick, cat: Catalogo, membri: Membro[], statoPercorso: string, adesso = new Date()) {
  if (!config.telegram.token) return;
  for (const persona of cat.persone) {
    const chat = config.telegram.chat(persona);
    if (!chat) continue;
    const dovuti = slotDovuti(adesso, cat, persona, leggiStato(statoPercorso).promemoria);
    for (const d of dovuti) {
      const segna = (valore: string) => {
        const stato = leggiStato(statoPercorso);
        stato.promemoria[d.chiave] = valore;
        // I giorni vecchi non servono più
        const limite = isoGiorno(giornoDi(new Date(adesso.getTime() - 3 * 86_400_000)));
        for (const k of Object.keys(stato.promemoria)) if (k.slice(0, 10) < limite) delete stato.promemoria[k];
        scriviStato(statoPercorso, stato);
      };
      if (d.sabato) {
        segna("sabato");
        continue;
      }
      try {
        const testo = await preparaMessaggio(client, cat, membri, persona, d.slot, adesso);
        if (testo === null) {
          segna("vuoto");
          continue;
        }
        await inviaMessaggio(chat, testo);
        segna(adesso.toISOString());
        console.log(`[promemoria] ${persona}: ${d.slot} inviato`);
      } catch (e) {
        // Non si segna: al prossimo giro si riprova, finché c'è tempo per recuperare
        console.error(`[promemoria] ${persona} ${d.slot}:`, (e as Error).message);
      }
    }
  }
}
