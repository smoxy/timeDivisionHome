import { useCallback, useEffect, useState } from "react";
import { Accesso } from "./Accesso.tsx";
import { api, NonAutorizzato } from "./api.ts";
import { dataLunga } from "./formati.ts";
import { Oggi } from "./Oggi.tsx";
import { Settimana } from "./Settimana.tsx";
import { Spesa } from "./Spesa.tsx";

type Scheda = "oggi" | "settimana" | "spesa";
const SCHEDE: { id: Scheda; nome: string }[] = [
  { id: "oggi", nome: "Oggi" },
  { id: "settimana", nome: "Settimana" },
  { id: "spesa", nome: "Spesa" },
];

function schedaSalvata(): Scheda {
  try {
    const s = localStorage.getItem("casa.scheda");
    return s === "settimana" || s === "spesa" ? s : "oggi";
  } catch {
    return "oggi";
  }
}

export function App() {
  const [io, setIo] = useState<string | null | undefined>(undefined);
  const [persone, setPersone] = useState<string[]>([]);
  const [scheda, setScheda] = useState<Scheda>(schedaSalvata);
  const [errore, setErrore] = useState<string | null>(null);

  useEffect(() => {
    api.persone().then((d) => setPersone(d.persone)).catch(() => {});
    api
      .io()
      .then((d) => setIo(d.persona))
      .catch(() => setIo(null));
  }, []);

  const onErrore = useCallback((e: unknown) => {
    if (e instanceof NonAutorizzato) setIo(null);
    else setErrore((e as Error).message);
  }, []);

  const scegli = (s: Scheda) => {
    setScheda(s);
    setErrore(null);
    try {
      localStorage.setItem("casa.scheda", s);
    } catch {
      // senza localStorage si riparte da Oggi
    }
  };

  if (io === undefined) return null;
  if (io === null) return <Accesso onEntrato={setIo} />;

  return (
    <div className="app">
      <header className="testata">
        <h1>{scheda === "oggi" ? dataLunga(new Date()) : scheda === "settimana" ? "Settimana" : "Spesa"}</h1>
        <button
          className="io"
          onClick={() => {
            if (confirm(`Uscire come ${io}?`)) api.esci().finally(() => setIo(null));
          }}
        >
          {io}
        </button>
      </header>

      {errore && (
        <p className="errore" role="alert">
          {errore}
          <button className="testo" onClick={() => setErrore(null)}>
            Chiudi
          </button>
        </p>
      )}

      <main>
        {scheda === "oggi" && <Oggi io={io} persone={persone} onErrore={onErrore} />}
        {scheda === "settimana" && <Settimana io={io} persone={persone} onErrore={onErrore} />}
        {scheda === "spesa" && <Spesa onErrore={onErrore} />}
      </main>

      <nav className="schede">
        {SCHEDE.map((s) => (
          <button key={s.id} aria-current={scheda === s.id ? "page" : undefined} onClick={() => scegli(s.id)}>
            {s.nome}
          </button>
        ))}
      </nav>
    </div>
  );
}
