import { useCallback, useEffect, useState } from "react";
import { api, type Settimana as DatiSettimana } from "./api.ts";
import { colore, dataBreve, durata, nomeGiorno, sommaGiorniIso } from "./formati.ts";

type Props = { io: string; persone: string[]; onErrore: (e: unknown) => void };

export function Settimana({ io, persone, onErrore }: Props) {
  const [da, setDa] = useState<string | undefined>(undefined);
  const [dati, setDati] = useState<DatiSettimana | null>(null);
  const [filtro, setFiltro] = useState<string>("tutti");

  const carica = useCallback(() => {
    api.settimana(da).then(setDati).catch(onErrore);
  }, [da, onErrore]);
  useEffect(carica, [carica]);

  if (!dati) return <p className="attesa">Carico la settimana…</p>;

  const questa = dati.giorni.some((g) => g.data === dati.oggi);
  const totale = Math.max(1, ...persone.map((p) => dati.minuti[p] ?? 0));
  const visibile = (chi: string) => filtro === "tutti" || chi === filtro || chi === "insieme";

  return (
    <>
      <div className="naviga">
        <button aria-label="Settimana prima" onClick={() => setDa(sommaGiorniIso(dati.da, -7))}>
          ‹
        </button>
        <h2>Dal {dataBreve(dati.da)} al {dataBreve(sommaGiorniIso(dati.da, 6))}</h2>
        <button aria-label="Settimana dopo" onClick={() => setDa(sommaGiorniIso(dati.da, 7))}>
          ›
        </button>
        {!questa && (
          <button className="torna" onClick={() => setDa(undefined)}>
            Questa settimana
          </button>
        )}
      </div>

      <div className="carico">
        {persone.map((p) => (
          <div key={p} className="barra" style={{ "--colore": colore(p, persone) } as React.CSSProperties}>
            <span className="chi">{p}</span>
            <span className="riempi" style={{ width: `${((dati.minuti[p] ?? 0) / totale) * 100}%` }} />
            <span className="quanto">{durata(dati.minuti[p] ?? 0)}</span>
          </div>
        ))}
      </div>

      <div className="filtro" role="group" aria-label="Mostra le faccende di">
        {["tutti", ...persone].map((f) => (
          <button key={f} aria-pressed={filtro === f} onClick={() => setFiltro(f)}>
            {f === "tutti" ? "Tutti" : f === io ? `${f} (tu)` : f}
          </button>
        ))}
      </div>

      {dati.personaConSede && (
        <GiorniInSede
          persona={dati.personaConSede}
          settimana={dati.da}
          sede={dati.sede}
          onSalvato={carica}
          onErrore={onErrore}
        />
      )}

      <ol className="giorni">
        {dati.giorni.map((g) => {
          const voci = g.voci.filter((v) => visibile(v.chi));
          return (
            <li key={g.data} className={`giorno ${g.data === dati.oggi ? "oggi" : ""} ${g.sigla === "sab" ? "sab" : ""}`}>
              <h3>
                {nomeGiorno(g.data)}
                {g.data === dati.oggi && <span className="etichetta-oggi">oggi</span>}
                {g.sigla === "ven" && g.tramonto && <span className="tramonto">sabato dalle {g.tramonto}</span>}
                {g.sigla === "sab" && g.tramonto && <span className="tramonto">riposo fino alle {g.tramonto}</span>}
              </h3>
              {voci.length === 0 ? (
                <p className="vuoto-giorno">{g.sigla === "sab" ? "Niente da fare." : "Libero."}</p>
              ) : (
                <ul>
                  {voci.map((v, i) => (
                    <li key={`${v.id}-${v.chi}-${i}`} style={{ "--colore": colore(v.chi, persone) } as React.CSSProperties}>
                      <span className="ora">{v.ora}</span>
                      <span className="pallino" aria-label={v.chi} />
                      <span className="nome">
                        {v.nome}
                        {v.spostataDalSabato && <em> dopo il tramonto</em>}
                        {v.spostataPerSede && <em> spostata per il cambio dei giorni in sede</em>}
                      </span>
                      <span className="minuti">{v.minuti ? durata(v.minuti) : ""}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>

      {dati.registro.length > 0 && (
        <section className="registro">
          <h3>Modifiche dell'assistente</h3>
          <ul>
            {dati.registro.map((r, i) => (
              <li key={i} className={r.applicata ? undefined : "scartata"}>
                <span className="nome">{r.nome || "Faccenda"}</span>: {r.azione}
                {r.motivo && <span className="motivo"> ({r.motivo})</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

const FERIALI = ["lun", "mar", "mer", "gio", "ven"];
const NOMI: Record<string, string> = { lun: "Lun", mar: "Mar", mer: "Mer", gio: "Gio", ven: "Ven" };

type SedeProps = {
  persona: string;
  settimana: string;
  sede: DatiSettimana["sede"];
  onSalvato: () => void;
  onErrore: (e: unknown) => void;
};

function GiorniInSede({ persona, settimana, sede, onSalvato, onErrore }: SedeProps) {
  const [scelti, setScelti] = useState<string[]>(sede.giorni);
  const [invio, setInvio] = useState(false);
  const [esito, setEsito] = useState<string | null>(null);
  useEffect(() => {
    setScelti(sede.giorni);
    setEsito(null);
  }, [settimana, sede.giorni.join()]);

  const quanti = sede.predefiniti.length;
  const cambiati = scelti.slice().sort().join() !== sede.giorni.slice().sort().join();
  const diversiDalSolito = sede.giorni.slice().sort().join() !== sede.predefiniti.slice().sort().join();
  const scegli = (g: string) =>
    setScelti((s) => (s.includes(g) ? s.filter((x) => x !== g) : s.length < quanti ? [...s, g] : [...s.slice(1), g]));

  const salva = async () => {
    setInvio(true);
    try {
      const r = await api.salvaSede(settimana, scelti);
      const spostate = r.esiti.length;
      setEsito(`${spostate === 1 ? "Spostata 1 faccenda" : `Spostate ${spostate} faccende`}.${r.avviso ? ` ${r.avviso}` : ""}`);
      onSalvato();
    } catch (e) {
      onErrore(e);
    } finally {
      setInvio(false);
    }
  };

  return (
    <section className="sede">
      <h3>
        Giorni in sede di {persona}
        {diversiDalSolito && <span className="diversi">diversi dal solito</span>}
      </h3>
      <div className="giorni-sede" role="group" aria-label={`Giorni in sede di ${persona}`}>
        {FERIALI.map((g) => (
          <button key={g} aria-pressed={scelti.includes(g)} disabled={!sede.modificabile || invio} onClick={() => scegli(g)}>
            {NOMI[g]}
          </button>
        ))}
      </div>
      {sede.modificabile && cambiati && (
        <div className="azioni">
          <button className="primario" disabled={invio || scelti.length !== quanti} onClick={salva}>
            Salva i giorni in sede
          </button>
          <button className="testo" onClick={() => setScelti(sede.giorni)}>
            Annulla
          </button>
        </div>
      )}
      {esito && <p className="esito">{esito}</p>}
    </section>
  );
}
