// Lista della spesa: una sola, ovunque. Se HA_SPESA_ENTITY è impostata, Casa usa la lista
// di Home Assistant (la stessa dell'app e dell'assistente vocale); altrimenti quella di Grocy.

import { config } from "./config.ts";
import { Grocy } from "./grocy.ts";
import { homeAssistant } from "./homeassistant.ts";

export type VoceSpesa = { id: string; nome: string; quantita: number; presa: boolean };

export interface ListaSpesa {
  voci(): Promise<VoceSpesa[]>;
  aggiungi(nome: string, quantita?: number): Promise<unknown>;
  segna(id: string, presa: boolean): Promise<unknown>;
  togliPrese(): Promise<number>;
}

class SpesaHomeAssistant implements ListaSpesa {
  readonly lista: string;
  constructor(lista: string) {
    this.lista = lista;
  }
  private get ha() {
    const ha = homeAssistant();
    if (!ha) throw new Error("Home Assistant non è configurato");
    return ha;
  }
  async voci() {
    return (await this.ha.elementi(this.lista)).map((e) => ({
      id: e.uid,
      nome: e.summary,
      quantita: 1,
      presa: e.status === "completed",
    }));
  }
  aggiungi(nome: string, quantita?: number) {
    // In Home Assistant la quantità resta nel testo, come la scrive chi aggiunge a mano
    return this.ha.servizio("todo", "add_item", { entity_id: this.lista, item: quantita && quantita > 1 ? `${quantita} ${nome}` : nome });
  }
  segna(id: string, presa: boolean) {
    return this.ha.servizio("todo", "update_item", { entity_id: this.lista, item: id, status: presa ? "completed" : "needs_action" });
  }
  async togliPrese() {
    const n = (await this.voci()).filter((v) => v.presa).length;
    if (n > 0) await this.ha.servizio("todo", "remove_completed_items", { entity_id: this.lista });
    return n;
  }
}

class SpesaGrocy implements ListaSpesa {
  private get grocy() {
    if (!config.grocyChiave) throw new Error("Manca GROCY_API_KEY");
    return new Grocy(config.grocyUrl, config.grocyChiave);
  }
  async voci() {
    return (await this.grocy.lista()).map((v) => ({ ...v, id: String(v.id) }));
  }
  aggiungi(nome: string, quantita?: number) {
    return this.grocy.aggiungi(nome, quantita ?? 1);
  }
  segna(id: string, presa: boolean) {
    return this.grocy.segna(Number(id), presa);
  }
  togliPrese() {
    return this.grocy.togliPrese();
  }
}

export function listaSpesa(): ListaSpesa {
  return config.ha.spesa ? new SpesaHomeAssistant(config.ha.spesa) : new SpesaGrocy();
}
