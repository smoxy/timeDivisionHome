// Servizio Casa: API per la UI e lavori periodici sopra Donetick, Grocy e Home Assistant.

import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { creaSessione, DURATA_SESSIONE_S, leggiSessione, troppiTentativi, verificaPassword } from "./accesso.ts";
import { type Occorrenza, occorrenze } from "./calendario.ts";
import type { Catalogo } from "./catalogo.ts";
import { config } from "./config.ts";
import { type DonetickChore, leggiMarcatore, type Membro } from "./donetick.ts";
import { leggiSole } from "./fotovoltaico.ts";
import { listaSpesa } from "./spesa.ts";
import { abbinaGiorni, applicaSede, type Esito, eseguiLavori, fuoriCasa } from "./lavori.ts";
import { applicaProposte, inviaEvento, type Proposta, tokenValido } from "./automazioni.ts";
import { homeAssistant, sincronizzaListe } from "./homeassistant.ts";
import { catalogo, donetickAdmin, donetickDi, utenteDi } from "./servizi.ts";
import { alba, sabatoCorrenteOProssimo, tramonto } from "./sole.ts";
import { leggiStato, scriviStato } from "./stato.ts";
import {
  confronta,
  domenicaDi,
  type Giorno,
  giornoDi,
  isoGiorno,
  istanteLocale,
  leggiGiorno,
  oraLocale,
  parti,
  SIGLE_GIORNI,
  type SiglaGiorno,
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

// Proposte dell'assistente (n8n): autenticate con il token condiviso, non con la sessione
app.post("/api/automazioni/proposte", async (c) => {
  if (!tokenValido(c.req.header("x-casa-token"))) return c.json({ errore: "Token non valido" }, 401);
  const { settimana, proposte } = await c.req.json<{ settimana: string; proposte: Proposta[] }>();
  if (!Array.isArray(proposte)) return c.json({ errore: "proposte deve essere un elenco" }, 400);
  const cat = catalogo();
  const { client, membri: elenco } = await donetickAdmin(cat);
  const esiti = await applicaProposte(client, cat, elenco, domenicaDi(leggiGiorno(settimana)), proposte, config.stato);
  for (const e of esiti) console.log(`[assistente] ${e.choreId}: ${e.azione}`);
  await lavoriCompleti().catch((e) => console.error("[lavori]", (e as Error).message));
  return c.json({ esiti });
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
  // e si aggiornano le liste di Home Assistant
  await lavoriCompleti().catch((e) => console.error("[lavori]", (e as Error).message));
  return c.json({ ok: true });
});

// Una faccenda della persona con i giorni in sede (o da fare insieme) che cade mentre è fuori casa
// in un nuovo giorno in sede: nella settimana si mostra nel giorno abbinato, dove l'ha spostata Casa.
function giornoDopoCambioSede(cat: Catalogo, o: Occorrenza, domenica: Giorno): Giorno | null {
  if (o.voce.sede || !cat.personaConSede || (o.chi !== cat.personaConSede && o.chi !== "insieme")) return null;
  if (!fuoriCasa(o.quando, cat)) return null;
  const coppia = abbinaGiorni(cat.sedePredefinita, cat.sedeDellaSettimana(domenica)).find((k) => k.prende === sigla(giornoDi(o.quando)));
  return coppia ? sommaGiorni(domenica, SIGLE_GIORNI.indexOf(coppia.lascia)) : null;
}

function settimanaDi(cat: Catalogo, da: Giorno) {
  const a = sommaGiorni(da, 6);
  const voci = occorrenze(cat, da, a).map((o) => {
    let quando = o.quando;
    const nuovoGiorno = giornoDopoCambioSede(cat, o, da);
    if (nuovoGiorno) {
      const { ore, minuti } = parti(quando);
      quando = istanteLocale(nuovoGiorno, ore, minuti);
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
      spostataPerSede: Boolean(nuovoGiorno),
    };
  });
  const minuti: Record<string, number> = {};
  for (const v of voci) {
    const chi = v.chi === "insieme" ? cat.persone : [v.chi];
    for (const p of chi) minuti[p] = (minuti[p] ?? 0) + v.minuti;
  }
  return { voci, minuti };
}

app.get("/api/settimana", (c) => {
  const cat = catalogo();
  const adesso = new Date();
  const da = domenicaDi(c.req.query("da") ? leggiGiorno(c.req.query("da")!) : giornoDi(adesso));
  const a = sommaGiorni(da, 6);
  const { voci, minuti } = settimanaDi(cat, da);
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
  const registro = leggiStato(config.stato).registro.filter((r) => r.settimana === isoGiorno(da));
  return c.json({
    da: isoGiorno(da),
    oggi: isoGiorno(giornoDi(adesso)),
    giorni,
    minuti,
    personaConSede: cat.personaConSede,
    sede: {
      giorni: cat.sedeDellaSettimana(da),
      predefiniti: cat.sedePredefinita,
      modificabile: c.get("persona") === cat.personaConSede && istanteLocale(sommaGiorni(da, 7)) > adesso,
    },
    registro,
  });
});

const FERIALI: SiglaGiorno[] = ["lun", "mar", "mer", "gio", "ven"];

app.put("/api/sede", async (c) => {
  const cat = catalogo();
  const persona = cat.personaConSede;
  if (!persona) return c.json({ errore: "Nessuno ha giorni in sede in faccende.yaml" }, 400);
  if (c.get("persona") !== persona) return c.json({ errore: `Solo ${persona} può cambiare i suoi giorni in sede` }, 403);
  const { settimana, giorni } = await c.req.json<{ settimana: string; giorni: SiglaGiorno[] }>();
  const scelti = [...new Set(giorni ?? [])];
  if (scelti.length !== cat.sedePredefinita.length || !scelti.every((g) => FERIALI.includes(g))) {
    return c.json({ errore: `Scegli ${cat.sedePredefinita.length} giorni da lunedì a venerdì` }, 400);
  }
  const adesso = new Date();
  const domenica = domenicaDi(leggiGiorno(settimana));
  if (istanteLocale(sommaGiorni(domenica, 7)) <= adesso) return c.json({ errore: "Quella settimana è già passata" }, 400);

  const prima = cat.sedeDellaSettimana(domenica);
  const stato = leggiStato(config.stato);
  const chiave = isoGiorno(domenica);
  const ordinati = FERIALI.filter((g) => scelti.includes(g));
  if (ordinati.join() === [...cat.sedePredefinita].sort((x, y) => FERIALI.indexOf(x) - FERIALI.indexOf(y)).join()) delete stato.sede[chiave];
  else stato.sede[chiave] = ordinati;
  // Le settimane passate non servono più
  for (const k of Object.keys(stato.sede)) if (confronta(leggiGiorno(k), sommaGiorni(domenicaDi(giornoDi(adesso)), -7)) < 0) delete stato.sede[k];
  scriviStato(config.stato, stato);

  const aggiornato = catalogo();
  const { client, membri: elenco } = await donetickAdmin(aggiornato);
  const id = utenteDi(persona, elenco)?.userId;
  if (id === undefined) return c.json({ errore: `Nessun utente Donetick per ${persona}` }, 400);
  const esiti = await applicaSede(client, id, domenica, prima, ordinati, aggiornato, adesso);
  esiti.push(...(await lavoriCompleti()));
  // L'assistente riceve il risultato e propone eventuali ribilanciamenti; se non risponde, va bene lo stesso
  inviaEvento(client, aggiornato, elenco, domenica, settimanaDi(aggiornato, domenica).minuti)
    .then((r) => console.log(`[assistente] ${r}`))
    .catch((e) => console.error("[assistente]", (e as Error).message));
  return c.json({
    giorni: ordinati,
    esiti,
    avviso: ordinati.includes("ven") ? "Il venerdì in sede si rientra dopo il tramonto per buona parte dell'anno." : undefined,
  });
});

app.post("/api/lavori", async (c) => {
  return c.json({ esiti: await lavoriCompleti() });
});

// --- Spesa e fotovoltaico --------------------------------------------------

app.get("/api/spesa", async (c) => c.json({ voci: await listaSpesa().voci() }));

app.post("/api/spesa", async (c) => {
  const { nome, quantita } = await c.req.json<{ nome: string; quantita?: number }>();
  if (!nome?.trim()) return c.json({ errore: "Scrivi cosa comprare" }, 400);
  await listaSpesa().aggiungi(nome.trim(), quantita);
  return c.json({ ok: true });
});

app.put("/api/spesa/:id", async (c) => {
  const { presa } = await c.req.json<{ presa: boolean }>();
  await listaSpesa().segna(c.req.param("id"), presa);
  return c.json({ ok: true });
});

app.delete("/api/spesa/prese", async (c) => c.json({ tolte: await listaSpesa().togliPrese() }));

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
    for (const e of await lavoriCompleti()) console.log(`[lavori] ${e.faccenda}: ${e.azione}`);
  } catch (e) {
    console.error("[lavori]", (e as Error).message);
  } finally {
    lavoriInCorso = false;
  }
}

// Prima si raccolgono le spunte fatte in Home Assistant, poi si correggono le scadenze,
// infine si riallineano le liste con il risultato.
async function lavoriCompleti(): Promise<Esito[]> {
  const cat = catalogo();
  const { client, membri } = await donetickAdmin(cat);
  const ha = homeAssistant();
  const esiti: Esito[] = [];
  if (ha) esiti.push(...(await sincronizzaListe(ha, await client.faccende(false), membri, cat)));
  esiti.push(...(await eseguiLavori(client, cat, new Date(), config.stato)));
  if (ha) esiti.push(...(await sincronizzaListe(ha, await client.faccende(false), membri, cat)));
  return esiti;
}

setTimeout(lavoriPeriodici, 5_000);
setInterval(lavoriPeriodici, config.intervalloLavoriMs);

serve({ fetch: app.fetch, port: config.porta }, (info) => console.log(`Casa in ascolto sulla porta ${info.port}`));
