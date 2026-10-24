import { useCallback, useEffect, useState } from "react";
import { ArcoDelGiorno } from "./ArcoDelGiorno.tsx";
import { api, type Faccenda, type Oggi as DatiOggi } from "./api.ts";
import { colore, durata, oraDi } from "./formati.ts";

type Props = { io: string; persone: string[]; onErrore: (e: unknown) => void };

export function Oggi({ io, persone, onErrore }: Props) {
  const [dati, setDati] = useState<DatiOggi | null>(null);
  const [fatte, setFatte] = useState<Set<number>>(new Set());
  const [inCorso, setInCorso] = useState<number | null>(null);

  const carica = useCallback(() => {
    api
      .oggi()
      .then((d) => {
        setDati(d);
        setFatte(new Set());
      })
      .catch(onErrore);
  }, [onErrore]);

  useEffect(() => {
    carica();
    const t = setInterval(carica, 60_000);
    return () => clearInterval(t);
  }, [carica]);

  const agisci = async (f: Faccenda, azione: "fatta" | "salta") => {
    setInCorso(f.id);
    try {
      await (azione === "fatta" ? api.fatta(f.id) : api.salta(f.id));
      setFatte((s) => new Set(s).add(f.id));
      setTimeout(carica, 900);
    } catch (e) {
      onErrore(e);
    } finally {
      setInCorso(null);
    }
  };

  if (!dati) return <p className="attesa">Carico la giornata…</p>;

  const inRitardo = dati.faccende.filter((f) => f.inRitardo);
  const diOggi = dati.faccende.filter((f) => !f.inRitardo);
  const ordine = [io, ...persone.filter((p) => p !== io), "insieme"];
  const gruppi = ordine
    .map((chi) => ({ chi, voci: diOggi.filter((f) => f.chi === chi) }))
    .filter((g) => g.voci.length > 0);

  return (
    <>
      <ArcoDelGiorno oggi={dati} persone={persone} fatte={fatte} />
      <Avvisi dati={dati} />

      {inRitardo.length > 0 && (
        <section className="gruppo ritardo">
          <h2>Rimaste indietro</h2>
          <Elenco voci={inRitardo} persone={persone} fatte={fatte} inCorso={inCorso} agisci={agisci} mostraGiorno />
        </section>
      )}

      {gruppi.map((g) => {
        const minuti = g.voci.reduce((s, f) => s + (f.minuti ?? 0), 0);
        return (
          <section className="gruppo" key={g.chi} style={{ "--colore": colore(g.chi, persone) } as React.CSSProperties}>
            <h2>
              <span className="pallino" />
              {g.chi === io ? "Le tue" : g.chi === "insieme" ? "Insieme" : g.chi}
              {minuti > 0 && <span className="totale">{durata(minuti)}</span>}
            </h2>
            <Elenco voci={g.voci} persone={persone} fatte={fatte} inCorso={inCorso} agisci={agisci} />
          </section>
        );
      })}

      {dati.faccende.length === 0 && <p className="vuoto">Per oggi non c'è altro da fare.</p>}
    </>
  );
}

function Avvisi({ dati }: { dati: DatiOggi }) {
  const { sabato, sole, giorno } = dati;
  const righe: React.ReactNode[] = [];
  if (sabato.inCorso) {
    righe.push(
      <p className="avviso sabato" key="sabato">
        È sabato: riposo fino alle {oraDi(sabato.fine)}.
      </p>,
    );
  } else if (giorno.sigla === "ven") {
    righe.push(
      <p className="avviso sabato" key="sabato">
        Il sabato inizia alle {oraDi(sabato.inizio)}. Tutto pronto per le {oraDi(new Date(new Date(sabato.inizio).getTime() - 30 * 60_000).toISOString())}.
      </p>,
    );
  }
  const extra = [
    sole.batteriaPct !== undefined
      ? `batteria al ${Math.round(sole.batteriaPct)}%${
          sole.batteriaUsabileKWh !== undefined
            ? ` (${sole.batteriaUsabileKWh.toLocaleString("it-IT", { maximumFractionDigits: 1 })} kWh usabili)`
            : ""
        }`
      : null,
    sole.produzioneW !== undefined ? `${(sole.produzioneW / 1000).toLocaleString("it-IT", { maximumFractionDigits: 1 })} kW adesso` : null,
  ].filter(Boolean);
  righe.push(
    <p className="avviso sole" key="sole">
      Lavatrice e lavastoviglie: partenza tra le {sole.fascia.da} e le {sole.fascia.a}
      {extra.length > 0 ? `, ${extra.join(", ")}` : ""}.
    </p>,
  );
  return <div className="avvisi">{righe}</div>;
}

type ElencoProps = {
  voci: Faccenda[];
  persone: string[];
  fatte: Set<number>;
  inCorso: number | null;
  agisci: (f: Faccenda, azione: "fatta" | "salta") => void;
  mostraGiorno?: boolean;
};

function Elenco({ voci, persone, fatte, inCorso, agisci, mostraGiorno }: ElencoProps) {
  return (
    <ul className="elenco">
      {voci.map((f) => {
        const fatta = fatte.has(f.id);
        return (
          <li key={f.id} className={fatta ? "fatta" : undefined} style={{ "--colore": colore(f.chi, persone) } as React.CSSProperties}>
            <button
              className="spunta"
              aria-label={`Segna come fatta: ${f.nome}`}
              disabled={fatta || inCorso === f.id}
              onClick={() => agisci(f, "fatta")}
            />
            <span className="ora">{mostraGiorno ? new Date(f.quando).toLocaleDateString("it-IT", { day: "numeric", month: "short" }) : f.ora}</span>
            <span className="nome">
              {f.nome}
              {f.sole && <span className="segno-sole" title="Da far partire nella fascia di sole" />}
              {mostraGiorno && f.chi !== "insieme" && <span className="chi">{f.chi}</span>}
            </span>
            {f.minuti ? <span className="minuti">{durata(f.minuti)}</span> : <span />}
            <button className="salta" disabled={fatta || inCorso === f.id} onClick={() => agisci(f, "salta")}>
              Salta
            </button>
          </li>
        );
      })}
    </ul>
  );
}
