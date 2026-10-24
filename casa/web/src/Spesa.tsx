import { useCallback, useEffect, useState } from "react";
import { api, type VoceSpesa } from "./api.ts";

export function Spesa({ onErrore }: { onErrore: (e: unknown) => void }) {
  const [voci, setVoci] = useState<VoceSpesa[] | null>(null);
  const [nuova, setNuova] = useState("");

  const carica = useCallback(() => {
    api
      .spesa()
      .then((d) => setVoci(d.voci))
      .catch(onErrore);
  }, [onErrore]);

  useEffect(() => {
    carica();
    const t = setInterval(carica, 30_000);
    return () => clearInterval(t);
  }, [carica]);

  const aggiungi = async () => {
    const testo = nuova.trim();
    if (!testo) return;
    // "6 mele" aggiunge 6 mele
    const m = /^(\d+)\s+(.+)$/.exec(testo);
    setNuova("");
    try {
      await api.aggiungi(m ? m[2] : testo, m ? Number(m[1]) : undefined);
      carica();
    } catch (e) {
      onErrore(e);
    }
  };

  const segna = async (v: VoceSpesa) => {
    setVoci((vs) => vs?.map((x) => (x.id === v.id ? { ...x, presa: !x.presa } : x)) ?? null);
    try {
      await api.segna(v.id, !v.presa);
    } catch (e) {
      onErrore(e);
      carica();
    }
  };

  const prese = voci?.filter((v) => v.presa).length ?? 0;
  const ordinate = [...(voci ?? [])].sort((a, b) => Number(a.presa) - Number(b.presa));

  return (
    <>
      <form
        className="aggiungi"
        onSubmit={(e) => {
          e.preventDefault();
          aggiungi();
        }}
      >
        <input
          value={nuova}
          onChange={(e) => setNuova(e.target.value)}
          placeholder="Cosa serve? Per esempio: 6 mele"
          aria-label="Cosa aggiungere alla lista"
          enterKeyHint="done"
        />
        <button type="submit" className="primario" disabled={!nuova.trim()}>
          Aggiungi
        </button>
      </form>

      {voci === null ? (
        <p className="attesa">Carico la lista…</p>
      ) : voci.length === 0 ? (
        <p className="vuoto">La lista è vuota. Scrivi qui sopra cosa serve.</p>
      ) : (
        <ul className="spesa">
          {ordinate.map((v) => (
            <li key={v.id} className={v.presa ? "presa" : undefined}>
              <label>
                <input type="checkbox" checked={v.presa} onChange={() => segna(v)} />
                <span className="nome">{v.nome}</span>
                {v.quantita > 1 && <span className="quantita">{v.quantita}</span>}
              </label>
            </li>
          ))}
        </ul>
      )}

      {prese > 0 && (
        <button
          className="testo togli"
          onClick={() =>
            api
              .togliPrese()
              .then(carica)
              .catch(onErrore)
          }
        >
          Togli dalla lista le cose prese ({prese})
        </button>
      )}
    </>
  );
}
