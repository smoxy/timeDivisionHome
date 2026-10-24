// Collegamenti condivisi tra server, lavori periodici e comandi.

import { leggiCatalogo, type Catalogo } from "./catalogo.ts";
import { config } from "./config.ts";
import { Donetick, type Membro } from "./donetick.ts";

export function catalogo(): Catalogo {
  return leggiCatalogo(config.catalogo);
}

export function donetickDi(persona: string): Donetick {
  const token = config.tokenDonetick(persona);
  if (!token) throw new Error(`Manca DONETICK_TOKEN_${persona.toUpperCase()}`);
  return new Donetick(config.donetickUrl, token);
}

// Il client dell'amministratore della cerchia: serve per importare e per i lavori periodici.
export async function donetickAdmin(cat: Catalogo): Promise<{ client: Donetick; membri: Membro[] }> {
  const conToken = cat.persone.filter((p) => config.tokenDonetick(p));
  if (conToken.length === 0) throw new Error("Nessun DONETICK_TOKEN_<PERSONA> configurato");
  const membri = await donetickDi(conToken[0]).membri();
  const admin = membri.find((m) => m.role === "admin" && m.isActive);
  const persona = conToken.find((p) => utenteDi(p, membri)?.userId === admin?.userId) ?? conToken[0];
  return { client: donetickDi(persona), membri };
}

export function utenteDi(persona: string, membri: Membro[]): Membro | undefined {
  const p = persona.toLowerCase();
  return membri.find((m) => m.username.toLowerCase() === p || m.displayName.toLowerCase() === p);
}

export function idUtenti(cat: Catalogo, membri: Membro[]): Map<string, number> {
  const mappa = new Map<string, number>();
  for (const p of cat.persone) {
    const m = utenteDi(p, membri);
    if (m) mappa.set(p.toLowerCase(), m.userId);
  }
  return mappa;
}
