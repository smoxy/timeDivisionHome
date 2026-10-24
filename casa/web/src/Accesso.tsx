import { useEffect, useState } from "react";
import { api } from "./api.ts";
import { colore } from "./formati.ts";

export function Accesso({ onEntrato }: { onEntrato: (persona: string) => void }) {
  const [persone, setPersone] = useState<string[]>([]);
  const [persona, setPersona] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [errore, setErrore] = useState<string | null>(null);
  const [invio, setInvio] = useState(false);

  useEffect(() => {
    api
      .persone()
      .then((d) => setPersone(d.persone))
      .catch(() => setErrore("Il servizio Casa non risponde. Controlla che sia avviato."));
  }, []);

  const entra = async () => {
    if (!persona) return;
    setInvio(true);
    setErrore(null);
    try {
      const r = await api.accedi(persona, password);
      onEntrato(r.persona);
    } catch (e) {
      setErrore((e as Error).message);
    } finally {
      setInvio(false);
    }
  };

  return (
    <main className="accesso">
      <h1>Casa</h1>
      <p>Chi sei?</p>
      <div className="chi-sei">
        {persone.map((p) => (
          <button
            key={p}
            aria-pressed={persona === p}
            style={{ "--colore": colore(p, persone) } as React.CSSProperties}
            onClick={() => setPersona(p)}
          >
            {p}
          </button>
        ))}
      </div>
      {persona && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            entra();
          }}
        >
          <label>
            Password
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          </label>
          <button type="submit" className="primario" disabled={invio || !password}>
            Entra
          </button>
        </form>
      )}
      {errore && <p className="errore">{errore}</p>}
    </main>
  );
}
