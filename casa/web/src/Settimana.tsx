import { useCallback, useEffect, useState } from "react";
import { api, type Settimana as DatiSettimana } from "./api.ts";
import { colore, dataBreve, durata, nomeGiorno, sommaGiorniIso } from "./formati.ts";

type Props = { io: string; persone: string[]; onErrore: (e: unknown) => void };

export function Settimana({ io, persone, onErrore }: Props) {
  const [da, setDa] = useState<string | undefined>(undefined);
  const [dati, setDati] = useState<DatiSettimana | null>(null);
  const [filtro, setFiltro] = useState<string>("tutti");
  const [scambio, setScambio] = useState(false);

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
        <div className="scambio">
          {scambio ? (
            <ScambioSede
              persona={dati.personaConSede}
              giorni={dati.giorni.map((g) => g.data)}
              onFatto={() => {
                setScambio(false);
                carica();
              }}
              onAnnulla={() => setScambio(false)}
              onErrore={onErrore}
            />
          ) : (
            <button className="testo" onClick={() => setScambio(true)}>
              {dati.personaConSede === io ? "Cambia un tuo giorno in sede" : `Cambia un giorno in sede di ${dati.personaConSede}`}
            </button>
          )}
        </div>
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
                        {v.scambiata && <em> spostata per il cambio di giorno</em>}
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
    </>
  );
}

type ScambioProps = {
  persona: string;
  giorni: string[];
  onFatto: () => void;
  onAnnulla: () => void;
  onErrore: (e: unknown) => void;
};

function ScambioSede({ persona, giorni, onFatto, onAnnulla, onErrore }: ScambioProps) {
  const feriali = giorni.slice(1, 6);
  const [inSede, setInSede] = useState(feriali[3]);
  const [daRemoto, setDaRemoto] = useState(feriali[2]);
  const [invio, setInvio] = useState(false);
  const [esito, setEsito] = useState<string | null>(null);

  const conferma = async () => {
    setInvio(true);
    try {
      const r = await api.scambio(inSede, daRemoto);
      setEsito(r.esiti.length === 1 ? "Spostata 1 faccenda." : `Spostate ${r.esiti.length} faccende.`);
      setTimeout(onFatto, 1200);
    } catch (e) {
      onErrore(e);
    } finally {
      setInvio(false);
    }
  };

  return (
    <form
      className="modulo-scambio"
      onSubmit={(e) => {
        e.preventDefault();
        conferma();
      }}
    >
      <label>
        {persona} va in sede
        <select value={inSede} onChange={(e) => setInSede(e.target.value)}>
          {feriali.map((g) => (
            <option key={g} value={g}>
              {nomeGiorno(g)}
            </option>
          ))}
        </select>
      </label>
      <label>
        e resta a casa
        <select value={daRemoto} onChange={(e) => setDaRemoto(e.target.value)}>
          {feriali.map((g) => (
            <option key={g} value={g}>
              {nomeGiorno(g)}
            </option>
          ))}
        </select>
      </label>
      <p className="spiega">Le faccende di {persona} del giorno in sede passano al giorno a casa, alla stessa ora.</p>
      {esito ? (
        <p className="esito">{esito}</p>
      ) : (
        <div className="azioni">
          <button type="submit" className="primario" disabled={invio || inSede === daRemoto}>
            Sposta le faccende
          </button>
          <button type="button" className="testo" onClick={onAnnulla}>
            Annulla
          </button>
        </div>
      )}
    </form>
  );
}
