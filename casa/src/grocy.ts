// Lista della spesa di Grocy (header GROCY-API-KEY).

export type VoceSpesa = { id: number; nome: string; quantita: number; presa: boolean };

type RigaGrocy = { id: number; product_id: number | null; note: string | null; amount: number; done: number };
type Prodotto = { id: number; name: string };

export class Grocy {
  readonly base: string;
  readonly chiave: string;

  constructor(base: string, chiave: string) {
    this.base = base.replace(/\/$/, "");
    this.chiave = chiave;
  }

  private async chiama<T>(metodo: string, percorso: string, corpo?: unknown): Promise<T> {
    const r = await fetch(`${this.base}/api${percorso}`, {
      method: metodo,
      headers: {
        "GROCY-API-KEY": this.chiave,
        accept: "application/json",
        ...(corpo === undefined ? {} : { "content-type": "application/json" }),
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const testo = await r.text();
    if (!r.ok) throw new Error(`Grocy ${metodo} ${percorso}: ${r.status} ${testo.slice(0, 300)}`);
    return (testo ? JSON.parse(testo) : null) as T;
  }

  async lista(): Promise<VoceSpesa[]> {
    const [righe, prodotti] = await Promise.all([
      this.chiama<RigaGrocy[]>("GET", "/objects/shopping_list"),
      this.chiama<Prodotto[]>("GET", "/objects/products"),
    ]);
    const nomi = new Map(prodotti.map((p) => [p.id, p.name]));
    return righe.map((r) => ({
      id: r.id,
      nome: (r.product_id ? nomi.get(r.product_id) : undefined) ?? r.note ?? "?",
      quantita: Number(r.amount),
      presa: Number(r.done) === 1,
    }));
  }

  aggiungi(nome: string, quantita = 1) {
    return this.chiama<{ created_object_id: number }>("POST", "/objects/shopping_list", {
      note: nome,
      amount: quantita,
      shopping_list_id: 1,
    });
  }

  segna(id: number, presa: boolean) {
    return this.chiama<null>("PUT", `/objects/shopping_list/${id}`, { done: presa ? 1 : 0 });
  }

  async togliPrese(): Promise<number> {
    const prese = (await this.lista()).filter((v) => v.presa);
    for (const v of prese) await this.chiama<null>("DELETE", `/objects/shopping_list/${v.id}`);
    return prese.length;
  }
}
