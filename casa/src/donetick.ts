// Client minimo delle API REST di Donetick (autenticazione con token API, header "secretkey").

export type DonetickChore = {
  id: number;
  name: string;
  description?: string | null;
  frequencyType: string;
  nextDueDate: string | null;
  assignedTo: number | null;
  assignees: { userId: number }[];
  isActive: boolean;
  updatedAt: string;
  points?: number | null;
};

export type Membro = { userId: number; username: string; displayName: string; role: string; isActive: boolean };

export class Donetick {
  readonly base: string;
  readonly token: string;

  constructor(base: string, token: string) {
    this.base = base.replace(/\/$/, "");
    this.token = token;
  }

  private async chiama<T>(metodo: string, percorso: string, corpo?: unknown): Promise<T> {
    const r = await fetch(`${this.base}/api/v1${percorso}`, {
      method: metodo,
      headers: { secretkey: this.token, ...(corpo === undefined ? {} : { "content-type": "application/json" }) },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const testo = await r.text();
    if (!r.ok) throw new Error(`Donetick ${metodo} ${percorso}: ${r.status} ${testo.slice(0, 300)}`);
    const dati = testo ? JSON.parse(testo) : {};
    return (dati.res ?? dati) as T;
  }

  faccende(anchearchiviate = false) {
    return this.chiama<DonetickChore[]>("GET", `/chores/${anchearchiviate ? "?includeArchived=true" : ""}`);
  }

  faccenda(id: number) {
    return this.chiama<DonetickChore>("GET", `/chores/${id}`);
  }

  crea(chore: Record<string, unknown>) {
    return this.chiama<number | { id: number }>("POST", "/chores/", chore);
  }

  modifica(chore: Record<string, unknown>) {
    return this.chiama<unknown>("PUT", "/chores/", chore);
  }

  fatta(id: number) {
    return this.chiama<DonetickChore>("POST", `/chores/${id}/do`, {});
  }

  salta(id: number) {
    return this.chiama<DonetickChore>("POST", `/chores/${id}/skip`, {});
  }

  async spostaScadenza(id: number, quando: Date) {
    // Donetick vuole updatedAt aggiornato per evitare modifiche concorrenti
    const attuale = await this.faccenda(id);
    return this.chiama<unknown>("PUT", `/chores/${id}/dueDate`, { dueDate: quando.toISOString(), updatedAt: attuale.updatedAt });
  }

  archivia(id: number) {
    return this.chiama<unknown>("PUT", `/chores/${id}/archive`);
  }

  ripristina(id: number) {
    return this.chiama<unknown>("PUT", `/chores/${id}/unarchive`);
  }

  membri() {
    return this.chiama<Membro[]>("GET", "/circles/members");
  }
}

// Ogni faccenda importata porta nella descrizione un marcatore [casa:id] o [casa:id:persona].
const MARCATORE = /\[casa:([\w-]+)(?::([\w-]+))?\]/;

export function marcatore(id: string, persona?: string) {
  return `[casa:${id}${persona ? `:${persona.toLowerCase()}` : ""}]`;
}

export function leggiMarcatore(chore: DonetickChore): { id: string; persona?: string } | null {
  const m = MARCATORE.exec(chore.description ?? "");
  return m ? { id: m[1], persona: m[2] } : null;
}
