// Collegamenti condivisi tra server, lavori periodici e comandi.

import { leggiCatalogo, type Catalogo } from "./catalogo.ts";
import { config } from "./config.ts";
import { Donetick, type Membro } from "./donetick.ts";
import { leggiStato } from "./stato.ts";
import { isoGiorno } from "./tempo.ts";

export function catalogo(): Catalogo {
  const cat = leggiCatalogo(config.catalogo);
  const sede = leggiStato(config.stato).sede;
  cat.sedeDellaSettimana = (domenica) => sede[isoGiorno(domenica)] ?? cat.sedePredefinita;
  return cat;
}

export function donetickDi(persona: string): Donetick {
  const token = config.tokenDonetick(persona);
  if (!token) throw new Error(`Manca DONETICK_TOKEN_${persona.toUpperCase()}`);
  return new Donetick(config.donetickUrl, token);
}

// Chi è chi in Donetick: ogni persona è l'utente a cui appartiene il suo token,
// così non conta come si chiama l'account. Si ricalcola ogni ora.
const idPersone = new Map<string, number>();
let idAggiornatiIl = 0;

async function aggiornaIdPersone(cat: Catalogo) {
  if (Date.now() - idAggiornatiIl < 60 * 60_000 && idPersone.size > 0) return;
  for (const p of cat.persone) {
    if (!config.tokenDonetick(p)) continue;
    const profilo = await donetickDi(p).profilo();
    idPersone.set(p.toLowerCase(), profilo.id);
  }
  idAggiornatiIl = Date.now();
}

// Il client dell'amministratore della cerchia: serve per importare e per i lavori periodici.
export async function donetickAdmin(cat: Catalogo): Promise<{ client: Donetick; membri: Membro[] }> {
  const conToken = cat.persone.filter((p) => config.tokenDonetick(p));
  if (conToken.length === 0) throw new Error("Nessun DONETICK_TOKEN_<PERSONA> configurato");
  await aggiornaIdPersone(cat);
  const membri = await donetickDi(conToken[0]).membri();
  const admin = membri.find((m) => m.role === "admin" && m.isActive);
  const persona = conToken.find((p) => utenteDi(p, membri)?.userId === admin?.userId) ?? conToken[0];
  return { client: donetickDi(persona), membri };
}

export function utenteDi(persona: string, membri: Membro[]): Membro | undefined {
  const p = persona.toLowerCase();
  const id = idPersone.get(p);
  if (id !== undefined) return membri.find((m) => m.userId === id && m.isActive);
  // Senza token: si prova con il nome, anche solo il primo del nome visualizzato
  return membri.find(
    (m) => m.isActive && [m.username, m.displayName, m.displayName.trim().split(/\s+/)[0]].some((n) => n.toLowerCase() === p),
  );
}

export function idUtenti(cat: Catalogo, membri: Membro[]): Map<string, number> {
  const mappa = new Map<string, number>();
  for (const p of cat.persone) {
    const m = utenteDi(p, membri);
    if (m) mappa.set(p.toLowerCase(), m.userId);
  }
  return mappa;
}
