// Liste delle faccende per persona in Home Assistant (integrazione "Lista di cose da fare locale").
// Casa le tiene allineate a Donetick: ci mette le faccende di oggi e quelle rimaste indietro,
// e quando una voce viene spuntata in Home Assistant la segna fatta in Donetick a nome di quella persona.

import { attivaIl } from "./calendario.ts";
import type { Catalogo } from "./catalogo.ts";
import { config } from "./config.ts";
import { type DonetickChore, leggiMarcatore, type Membro } from "./donetick.ts";
import type { Esito } from "./lavori.ts";
import { donetickDi, utenteDi } from "./servizi.ts";
import { giornoDi, istanteLocale, parti, sommaGiorni } from "./tempo.ts";

type Elemento = { uid: string; summary: string; status: "needs_action" | "completed"; due?: string; description?: string };

export class HomeAssistant {
  readonly base: string;
  readonly token: string;

  constructor(base: string, token: string) {
    this.base = base.replace(/\/$/, "");
    this.token = token;
  }

  async servizio(dominio: string, servizio: string, dati: Record<string, unknown>, risposta = false) {
    const r = await fetch(`${this.base}/api/services/${dominio}/${servizio}${risposta ? "?return_response" : ""}`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify(dati),
      signal: AbortSignal.timeout(10_000),
    });
    const testo = await r.text();
    if (!r.ok) throw new Error(`Home Assistant ${dominio}.${servizio}: ${r.status} ${testo.slice(0, 200)}`);
    return testo ? JSON.parse(testo) : null;
  }

  async elementi(lista: string): Promise<Elemento[]> {
    const r = await this.servizio("todo", "get_items", { entity_id: lista, status: ["needs_action", "completed"] }, true);
    return r?.service_response?.[lista]?.items ?? [];
  }

  aggiungi(lista: string, voce: { summary: string; due_datetime: string; description: string }) {
    return this.servizio("todo", "add_item", { entity_id: lista, item: voce.summary, due_datetime: voce.due_datetime, description: voce.description });
  }

  cambiaScadenza(lista: string, uid: string, due_datetime: string) {
    return this.servizio("todo", "update_item", { entity_id: lista, item: uid, due_datetime });
  }

  togli(lista: string, uid: string) {
    return this.servizio("todo", "remove_item", { entity_id: lista, item: uid });
  }

  rimettiDaFare(lista: string, uid: string) {
    return this.servizio("todo", "update_item", { entity_id: lista, item: uid, status: "needs_action" });
  }

  private async leggi<T>(percorso: string): Promise<T> {
    const r = await fetch(`${this.base}${percorso}`, {
      headers: { authorization: `Bearer ${this.token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new Error(`Home Assistant ${percorso}: ${r.status}`);
    return r.json() as Promise<T>;
  }

  // Utente Home Assistant -> persona di casa, dalle entità person.* (il primo nome deve coincidere)
  async personeDegliUtenti(persone: string[]): Promise<Map<string, string>> {
    const stati = await this.leggi<{ entity_id: string; attributes: { friendly_name?: string; user_id?: string } }[]>("/api/states");
    const mappa = new Map<string, string>();
    for (const s of stati) {
      if (!s.entity_id.startsWith("person.") || !s.attributes.user_id) continue;
      const nome = (s.attributes.friendly_name ?? "").trim().split(/\s+/)[0].toLowerCase();
      const p = persone.find((x) => x.toLowerCase() === nome);
      if (p) mappa.set(s.attributes.user_id, p);
    }
    return mappa;
  }

  // Chi ha spuntato per ultimo qualcosa nella lista: la voce di registro più recente in cui
  // il numero di cose da fare è sceso. null se non si sa.
  async ultimoCheHaSpuntato(lista: string, daQuando: Date): Promise<string | null> {
    const voci = await this.leggi<{ when: string; state: string; context_user_id?: string }[]>(
      `/api/logbook/${daQuando.toISOString()}?entity=${lista}`,
    );
    let chi: string | null = null;
    for (let i = 1; i < voci.length; i++) {
      if (Number(voci[i].state) < Number(voci[i - 1].state) && voci[i].context_user_id) chi = voci[i].context_user_id!;
    }
    return chi;
  }
}

export function homeAssistant(): HomeAssistant | null {
  return config.ha.url && config.ha.token ? new HomeAssistant(config.ha.url, config.ha.token) : null;
}

const MARCATORE = /\[dt:(\d+)\]/;

// Data e ora locali senza fuso: Home Assistant le interpreta nel proprio fuso, che è quello di casa
function oraLocaleCompleta(t: Date): string {
  const p = parti(t);
  const due = (n: number) => String(n).padStart(2, "0");
  return `${p.anno}-${due(p.mese)}-${due(p.giorno)} ${due(p.ore)}:${due(p.minuti)}:00`;
}

export function diQuesta(c: DonetickChore, idPersona: number): boolean {
  return c.assignedTo === idPersona || (c.assignedTo == null && c.assignees.some((a) => a.userId === idPersona));
}

export async function sincronizzaListe(
  ha: HomeAssistant,
  faccende: DonetickChore[],
  membri: Membro[],
  cat: Catalogo,
  adesso = new Date(),
): Promise<Esito[]> {
  const esiti: Esito[] = [];
  const fineOggi = istanteLocale(sommaGiorni(giornoDi(adesso), 1));
  const voci = new Map(cat.faccende.map((v) => [v.id, v]));
  const dovute = faccende.filter((c) => {
    if (!c.isActive || !c.nextDueDate || new Date(c.nextDueDate) >= fineOggi) return false;
    const voce = voci.get(leggiMarcatore(c)?.id ?? "");
    return !voce || attivaIl(voce, giornoDi(adesso), cat);
  });
  const fatteOra = new Set<number>();
  const utentiHa = await ha.personeDegliUtenti(cat.persone);

  for (const persona of cat.persone) {
    const lista = config.ha.todo(persona);
    const utente = utenteDi(persona, membri);
    if (!lista || !utente) continue;
    const mie = new Map(dovute.filter((c) => diQuesta(c, utente.userId)).map((c) => [c.id, c]));
    const presenti = new Set<number>();
    const elementi = await ha.elementi(lista);
    // Le faccende personali le spunta solo chi le deve fare: se l'ultima spunta in questa lista
    // è di un'altra persona di casa, quelle personali tornano da fare e non si segnano in Donetick.
    let spuntaAltrui: string | null = null;
    let chiHaSpuntato = persona;
    if (elementi.some((el) => el.status === "completed")) {
      const chi = await ha.ultimoCheHaSpuntato(lista, new Date(adesso.getTime() - 15 * 60_000));
      const altra = chi ? utentiHa.get(chi) : undefined;
      if (altra) chiHaSpuntato = altra;
      if (altra && altra !== persona) spuntaAltrui = altra;
    }

    for (const el of elementi) {
      const id = Number(MARCATORE.exec(el.description ?? "")?.[1]);
      if (!id) continue; // voci aggiunte a mano: non si toccano
      const c = mie.get(id);
      if (el.status === "completed" && c && spuntaAltrui && c.assignedTo != null) {
        await ha.rimettiDaFare(lista, el.uid);
        presenti.add(id);
        esiti.push({ faccenda: c.name, azione: `spunta di ${spuntaAltrui} annullata: è una faccenda di ${persona}` });
        continue;
      }
      if (el.status === "completed") {
        if (c && !fatteOra.has(id)) {
          // Le faccende da fare insieme risultano fatte da chi le ha spuntate davvero
          const autore = c.assignedTo == null ? chiHaSpuntato : persona;
          await donetickDi(autore).fatta(id);
          fatteOra.add(id);
          esiti.push({ faccenda: c.name, azione: `fatta da ${autore} in Home Assistant` });
        }
        await ha.togli(lista, el.uid);
      } else if (!c || fatteOra.has(id)) {
        await ha.togli(lista, el.uid);
      } else {
        presenti.add(id);
        if (!el.due || new Date(el.due).getTime() !== new Date(c.nextDueDate!).getTime()) {
          await ha.cambiaScadenza(lista, el.uid, oraLocaleCompleta(new Date(c.nextDueDate!)));
        }
      }
    }

    for (const c of mie.values()) {
      if (presenti.has(c.id) || fatteOra.has(c.id)) continue;
      const voce = voci.get(leggiMarcatore(c)?.id ?? "");
      const dettagli = [voce?.minuti ? `${voce.minuti} min` : null, c.assignedTo == null ? "insieme" : null].filter(Boolean).join(", ");
      await ha.aggiungi(lista, {
        summary: voce?.nome ?? c.name,
        due_datetime: oraLocaleCompleta(new Date(c.nextDueDate!)),
        description: `${dettagli}${dettagli ? "\n" : ""}[dt:${c.id}]`,
      });
    }
  }
  return esiti;
}
