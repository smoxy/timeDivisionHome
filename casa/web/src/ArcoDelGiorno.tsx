// La giornata come arco di sole: dall'alba al tramonto, con la fascia per le macchine,
// l'ora attuale e le faccende al loro orario.

import type { Faccenda, Oggi } from "./api.ts";
import { colore, minutiDa } from "./formati.ts";

const INIZIO = 6 * 60;
const FINE = 22 * 60 + 30;
// Disegnato alla larghezza di un telefono, così le scritte restano leggibili
const L = 360;
const ALTO = 124;
const BASE = 88;
const MARGINE = 10;

const x = (minuti: number) => MARGINE + ((Math.min(Math.max(minuti, INIZIO), FINE) - INIZIO) / (FINE - INIZIO)) * (L - 2 * MARGINE);

type Props = { oggi: Oggi; persone: string[]; fatte: Set<number> };

export function ArcoDelGiorno({ oggi, persone, fatte }: Props) {
  const alba = minutiDa(oggi.giorno.alba);
  const tramonto = minutiDa(oggi.giorno.tramonto);
  const adesso = minutiDa(new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit" }).format(new Date()));
  const x0 = x(alba);
  const x1 = x(tramonto);
  const altezza = 68;
  // Arco come metà ellisse: y in funzione di x
  const yArco = (xx: number) => {
    const t = (xx - x0) / (x1 - x0);
    return BASE - altezza * Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2));
  };
  const da = x(minutiDa(oggi.sole.fascia.da));
  const a = x(minutiDa(oggi.sole.fascia.a));
  const passi = 40;
  const fascia = [`M ${da} ${BASE}`];
  for (let i = 0; i <= passi; i++) {
    const xx = da + ((a - da) * i) / passi;
    fascia.push(`L ${xx.toFixed(1)} ${yArco(xx).toFixed(1)}`);
  }
  fascia.push(`L ${a} ${BASE} Z`);

  const giornoChiaro = adesso > alba && adesso < tramonto;
  const venerdi = oggi.giorno.sigla === "ven";
  const xAdesso = x(adesso);

  // Faccende raggruppate per orario, impilate se cadono alla stessa ora
  const perOra = new Map<number, Faccenda[]>();
  for (const f of oggi.faccende.filter((f) => !f.inRitardo)) {
    const k = Math.round(x(minutiDa(f.ora)));
    perOra.set(k, [...(perOra.get(k) ?? []), f]);
  }

  return (
    <figure className="arco" aria-label={`Alba ${oggi.giorno.alba}, tramonto ${oggi.giorno.tramonto}, macchine tra ${oggi.sole.fascia.da} e ${oggi.sole.fascia.a}`}>
      <svg viewBox={`0 0 ${L} ${ALTO}`} role="img">
        <path d={fascia.join(" ")} className="arco-fascia" />
        <path d={`M ${x0} ${BASE} A ${(x1 - x0) / 2} ${altezza} 0 0 1 ${x1} ${BASE}`} className="arco-cielo" />
        <line x1={MARGINE} x2={L - MARGINE} y1={BASE} y2={BASE} className="arco-orizzonte" />
        {[8, 12, 16, 20].map((h) => (
          <text key={h} x={x(h * 60)} y={BASE + 30} className="arco-ora" textAnchor="middle">
            {h}
          </text>
        ))}
        {[...perOra.entries()].map(([xx, fs]) =>
          fs.map((f, i) => (
            <circle
              key={f.id}
              cx={xx}
              cy={BASE + 8 + i * 6}
              r={2.6}
              fill={fatte.has(f.id) ? "none" : colore(f.chi, persone)}
              stroke={colore(f.chi, persone)}
              strokeWidth={1.4}
            />
          )),
        )}
        {giornoChiaro ? (
          <circle cx={xAdesso} cy={yArco(xAdesso)} r={8} className="arco-sole" />
        ) : (
          <line x1={xAdesso} x2={xAdesso} y1={BASE - 22} y2={BASE} className="arco-adesso" />
        )}
        <text x={x0} y={BASE - 6} className="arco-etichetta" textAnchor="end" dx={-4}>
          {oggi.giorno.alba}
        </text>
        <text x={x1} y={BASE - 6} className={venerdi ? "arco-etichetta sabato" : "arco-etichetta"} textAnchor={venerdi ? "end" : "start"} dx={venerdi ? -4 : 4}>
          {venerdi ? `sabato dalle ${oggi.giorno.tramonto}` : oggi.giorno.tramonto}
        </text>
      </svg>
    </figure>
  );
}
