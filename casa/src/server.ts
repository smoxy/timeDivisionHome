// Servizio Casa: API per la UI e lavori periodici sopra Donetick, Grocy e Home Assistant.

import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { creaSessione, DURATA_SESSIONE_S, leggiSessione, troppiTentativi, verificaPassword } from "./accesso.ts";
import { occorrenze } from "./calendario.ts";
import type { Catalogo } from "./catalogo.ts";
import { config } from "./config.ts";
import { type DonetickChore, leggiMarcatore, type Membro } from "./donetick.ts";
import { leggiSole } from "./fotovoltaico.ts";
import { Grocy } from "./grocy.ts";
import { eseguiLavori, scambiaSede } from "./lavori.ts";
import { catalogo, donetickAdmin, donetickDi, utenteDi } from "./servizi.ts";
import { alba, sabatoCorrenteOProssimo, tramonto } from "./sole.ts";
import { leggiStato, scriviStato } from "./stato.ts";
import {
  confronta,
  domenicaDi,
  giornoDi,
  isoGiorno,
  istanteLocale,
  leggiGiorno,
  oraLocale,
  parti,
  sigla,
  sommaGiorni,
} from "./tempo.ts";

type Variabili = { Variables: { persona: string } };
const app = new Hono<Variabili>();
const COOKIE = "casa_sessione";

// Il catalogo si rilegge a ogni richiesta: si può modificare faccende.yaml senza riavviare.
let membriInCache: { membri: Membro[]; scade: number } | null = null;
async function membri(cat: Catalogo): Promise<Membro[]> {
  if (membriInCache && membriInCache.scade > Date.now()) return membriInCache.membri;
  const { membri } = await donetickAdmin(cat);
  membriInCache = { membri, scade: Date.now() + 10 * 60_000 };
  return membri;
}

function grocy(): Grocy {
  if (!config.grocyChiave) throw new Error("Manca GROCY_API_KEY");
  return new Grocy(config.grocyUrl, config.grocyChiave);
}

app.onError((err, c) => {
  console.error(err);
  return c.json({ errore: err.message }, 500);
});

// --- Accesso ---------------------------------------------------------------

app.get("/api/persone", (c) => {
  const cat = catalogo();
  return c.json({ persone: cat.persone, luogo: cat.luogo.nome });
});

app.post("/api/accesso", async (c) => {
  const ip = c.req.header("x-forwarded-for")?.split(",")[0].trim() ?? "locale";
  if (troppiTentativi(ip)) return c.json({ errore: "Troppi tentativi, riprova tra un minuto" }, 429);
  const { persona, password } = await c.req.json<{ persona: string; password: string }>();
  const cat = catalogo();
  if (!cat.persone.includes(persona) || !verificaPassword(String(password ?? ""), config.password(persona))) {
    return c.json({ errore: "Persona o password sbagliata" }, 401);
  }
  setCookie(c, COOKIE, creaSessione(persona, config.segreto()), {
    httpOnly: true,
    sameSite: "Lax",
    secure: config.cookieSicuro,
    path: "/",
    maxAge: DURATA_SESSIONE_S,
  });
  return c.json({ persona });
});

app.post("/api/esci", (c) => {
  deleteCookie(c, COOKIE, { path: "/" });
  return c.json({ ok: true });
});

app.use("/api/*", async (c, next) => {
  const persona = leggiSessione(getCookie(c, COOKIE), config.segreto());
  if (!persona) return c.json({ errore: "Accesso richiesto" }, 401);
  c.set("persona", persona);
  await next();
});

app.get("/api/io", (c) => c.json({ persona: c.get("persona") }));

// --- Faccende --------------------------------------------------------------

function infoSabato(cat: Catalogo, adesso: Date) {
  const f = sabatoCorrenteOProssimo(adesso, cat.luogo);
  return { inizio: f.inizio.toISOString(), fine: f.fine.toISOString(), inCorso: adesso >= f.inizio && adesso < f.fine };
}

function perLaUi(c: DonetickChore, cat: Catalogo, elenco: Membro[], adesso: Date) {
  const m = leggiMarcatore(c);
  const voce = cat.faccende.find((v) => v.id === m?.id);
  const persona = (id: number) => cat.persone.find((p) => utenteDi(p, elenco)?.userId === id);
  const chi = c.assignedTo != null ? (persona(c.assignedTo) ?? "?") : "insieme";
  const quando = new Date(c.nextDueDate!);
  return {
    id: c.id,
    nome: voce ? voce.nome : c.name,
    chi,
    quando: quando.toISOString(),
    ora: oraLocale(quando),
    inRitardo: quando < adesso && confronta(giornoDi(quando), giornoDi(adesso)) < 0,
    minuti: voce?.minuti,
    area: voce?.area,
    sole: voce?.sole ?? false,
    note: voce?.note,
  };
}

app.get("/api/oggi", async (c) => {
  const cat = catalogo();
  const adesso = new Date();
  const fineGiornata = istanteLocale(sommaGiorni(giornoDi(adesso), 1));
  const { client } = await donetickAdmin(cat);
  const elenco = await membri(cat);
  const [tutte, sole] = await Promise.all([client.faccende(false), leggiSole(adesso)]);
  const faccende = tutte
    .filter((f) => f.isActive && f.nextDueDate && new Date(f.nextDueDate) < fineGiornata)
    .map((f) => perLaUi(f, cat, elenco, adesso))
    .sort((a, b) => a.quando.localeCompare(b.quando));
  const oggi = giornoDi(adesso);
  return c.json({
    adesso: adesso.toISOString(),
    giorno: { data: isoGiorno(oggi), sigla: sigla(oggi), alba: oraLocale(alba(oggi, cat.luogo)), tramonto: oraLocale(tramonto(oggi, cat.luogo)) },
    sabato: infoSabato(cat, adesso),
    sole,
    faccende,
  });
});

app.post("/api/faccende/:id/:azione{fatta|salta}", async (c) => {
  const id = Number(c.req.param("id"));
  const client = donetickDi(c.get("persona"));
  if (c.req.param("azione") === "fatta") await client.fatta(id);
  else await client.salta(id);
  // Dopo il completamento Donetick calcola la prossima scadenza: la si corregge subito
  const cat = catalogo();
  await eseguiLavori((await donetickAdmin(cat)).client, cat);
  return c.json({ ok: true });
});

app.get("/api/settimana", (c) => {
  const cat = catalogo();
  const adesso = new Date();
  const da = domenicaDi(c.req.query("da") ? leggiGiorno(c.req.query("da")!) : giornoDi(adesso));
  const a = sommaGiorni(da, 6);
  const scambi = leggiStato(config.stato).scambi;

  const voci = occorrenze(cat, da, a).map((o) => {
    let quando = o.quando;
    // Un giorno in sede spostato porta con sé le faccende di quel giorno
    const s = scambi.find((x) => x.persona === o.chi && x.inSede === isoGiorno(giornoDi(quando)));
    if (s) {
      const { ore, minuti } = parti(quando);
      quando = istanteLocale(leggiGiorno(s.daRemoto), ore, minuti);
    }
    return {
      id: o.voce.id,
      nome: o.voce.nome,
      chi: o.chi,
      giorno: isoGiorno(giornoDi(quando)),
      ora: oraLocale(quando),
      minuti: o.voce.minuti,
      area: o.voce.area,
      sole: o.voce.sole,
      spostataDalSabato: o.spostataDalSabato,
      scambiata: Boolean(s),
    };
  });

  const giorni = [];
  for (let g = da; confronta(g, a) <= 0; g = sommaGiorni(g, 1)) {
    const iso = isoGiorno(g);
    giorni.push({
      data: iso,
      sigla: sigla(g),
      tramonto: sigla(g) === "ven" || sigla(g) === "sab" ? oraLocale(tramonto(g, cat.luogo)) : undefined,
      voci: voci.filter((v) => v.giorno === iso).sort((x, y) => x.ora.localeCompare(y.ora)),
    });
  }
  const minuti: Record<string, number> = {};
  for (const v of voci) {
    const chi = v.chi === "insieme" ? cat.persone : [v.chi];
    for (const p of chi) minuti[p] = (minuti[p] ?? 0) + v.minuti;
  }
  return c.json({ da: isoGiorno(da), oggi: isoGiorno(giornoDi(adesso)), giorni, minuti, personaConSede: cat.personaConSede, scambi });
});

app.post("/api/sede/scambio", async (c) => {
  const cat = catalogo();
  const persona = cat.personaConSede;
  if (!persona) return c.json({ errore: "Nessuno ha giorni in sede in faccende.yaml" }, 400);
  const { inSede, daRemoto } = await c.req.json<{ inSede: string; daRemoto: string }>();
  const nuovoSede = leggiGiorno(inSede);
  const nuovoRemoto = leggiGiorno(daRemoto);
  if (Math.abs(confronta(nuovoSede, nuovoRemoto)) > 6) return c.json({ errore: "I due giorni devono essere nella stessa settimana" }, 400);
  const { client } = await donetickAdmin(cat);
  const id = utenteDi(persona, await membri(cat))?.userId;
  if (id === undefined) return c.json({ errore: `Nessun utente Donetick per ${persona}` }, 400);
  const esiti = await scambiaSede(client, id, nuovoRemoto, nuovoSede, cat);
  const stato = leggiStato(config.stato);
  stato.scambi = stato.scambi.filter((s) => confronta(leggiGiorno(s.inSede), sommaGiorni(giornoDi(new Date()), -14)) >= 0);
  stato.scambi.push({ persona, inSede, daRemoto, creato: new Date().toISOString() });
  scriviStato(config.stato, stato);
  return c.json({ esiti });
});

app.post("/api/lavori", async (c) => {
  const cat = catalogo();
  return c.json({ esiti: await eseguiLavori((await donetickAdmin(cat)).client, cat) });
});

// --- Spesa e fotovoltaico --------------------------------------------------

app.get("/api/spesa", async (c) => c.json({ voci: await grocy().lista() }));

app.post("/api/spesa", async (c) => {
  const { nome, quantita } = await c.req.json<{ nome: string; quantita?: number }>();
  if (!nome?.trim()) return c.json({ errore: "Scrivi cosa comprare" }, 400);
  await grocy().aggiungi(nome.trim(), quantita ?? 1);
  return c.json({ ok: true });
});

app.put("/api/spesa/:id", async (c) => {
  const { presa } = await c.req.json<{ presa: boolean }>();
  await grocy().segna(Number(c.req.param("id")), presa);
  return c.json({ ok: true });
});

app.delete("/api/spesa/prese", async (c) => c.json({ tolte: await grocy().togliPrese() }));

app.get("/api/sole", async (c) => c.json(await leggiSole()));

// --- Interfaccia ------------------------------------------------------------

const TIPI: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
  ".json": "application/json",
};

app.get("*", async (c) => {
  const percorso = normalize(c.req.path).replace(/^(\.\.[/\\])+/, "");
  const file = join(config.web, percorso === "/" ? "index.html" : percorso);
  try {
    const dati = await readFile(file.startsWith(config.web) ? file : join(config.web, "index.html"));
    return c.body(dati, 200, { "content-type": TIPI[extname(file)] ?? "application/octet-stream" });
  } catch {
    // Applicazione a pagina singola: ogni percorso sconosciuto apre l'indice
    const indice = await readFile(join(config.web, "index.html")).catch(() => null);
    return indice ? c.html(indice.toString()) : c.text("Interfaccia non compilata: npm run build", 404);
  }
});

// --- Avvio -----------------------------------------------------------------

let lavoriInCorso = false;
async function lavoriPeriodici() {
  if (lavoriInCorso) return;
  lavoriInCorso = true;
  try {
    const cat = catalogo();
    const esiti = await eseguiLavori((await donetickAdmin(cat)).client, cat);
    for (const e of esiti) console.log(`[lavori] ${e.faccenda}: ${e.azione}`);
  } catch (e) {
    console.error("[lavori]", (e as Error).message);
  } finally {
    lavoriInCorso = false;
  }
}

setTimeout(lavoriPeriodici, 5_000);
setInterval(lavoriPeriodici, config.intervalloLavoriMs);

serve({ fetch: app.fetch, port: config.porta }, (info) => console.log(`Casa in ascolto sulla porta ${info.port}`));
