// Configurazione da variabili d'ambiente (vedi .env.example nella cartella principale).

function obbligatoria(nome: string): string {
  const v = process.env[nome];
  if (!v) throw new Error(`Manca la variabile d'ambiente ${nome}`);
  return v;
}

const env = (nome: string) => process.env[nome] || undefined;

export const config = {
  porta: Number(process.env.PORT ?? 8080),
  catalogo: process.env.CATALOG_PATH ?? new URL("../../faccende.yaml", import.meta.url).pathname,
  stato: process.env.STATE_PATH ?? new URL("../../data/casa/stato.json", import.meta.url).pathname,
  web: new URL("../dist/web", import.meta.url).pathname,
  segreto: () => obbligatoria("CASA_SECRET"),
  cookieSicuro: process.env.CASA_COOKIE_SECURE !== "false",
  // Valori per persona: CASA_PASSWORD_ANNA, DONETICK_TOKEN_LUCA, ...
  password: (persona: string) => env(`CASA_PASSWORD_${persona.toUpperCase()}`),
  tokenDonetick: (persona: string) => env(`DONETICK_TOKEN_${persona.toUpperCase()}`),
  donetickUrl: process.env.DONETICK_URL ?? "http://127.0.0.1:2021",
  grocyUrl: process.env.GROCY_URL ?? "http://127.0.0.1:9283",
  grocyChiave: env("GROCY_API_KEY"),
  ha: {
    url: env("HA_URL"),
    token: env("HA_TOKEN"),
    potenza: env("HA_PV_POWER_ENTITY"),
    batteria: env("HA_BATTERY_SOC_ENTITY"),
    piccoOggi: env("HA_PEAK_TIME_TODAY_ENTITY"),
    piccoDomani: env("HA_PEAK_TIME_TOMORROW_ENTITY"),
    // Lista delle faccende di ciascuno: HA_TODO_ANNA=todo.faccende_anna, ...
    todo: (persona: string) => env(`HA_TODO_${persona.toUpperCase()}`),
  },
  // Ogni quanto girano i lavori periodici (sabato, stagioni, mesi, ritardi, liste di Home Assistant)
  intervalloLavoriMs: Number(process.env.CASA_JOBS_INTERVAL_MS ?? 2 * 60_000),
};
