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
    // Consumo della casa e scambio con la rete (positivo = prelievo), per il surplus in tempo reale
    carico: env("HA_LOAD_POWER_ENTITY"),
    rete: env("HA_GRID_POWER_ENTITY"),
    // Capacità della batteria e riserva minima, per calcolare l'energia davvero usabile
    batteriaKWh: Number(process.env.HA_BATTERY_CAPACITY_KWH ?? 0),
    batteriaRiservaPct: Number(process.env.HA_BATTERY_RESERVE_PCT ?? 0),
    // Energia prodotta oggi (kWh), per correggere la previsione con quanto il sole ha reso finora
    produzioneOggi: env("HA_PV_TODAY_ENTITY"),
    piccoOggi: env("HA_PEAK_TIME_TODAY_ENTITY"),
    piccoDomani: env("HA_PEAK_TIME_TOMORROW_ENTITY"),
    // Ora limite delle macchine di oggi, scritta da Casa: input_datetime (data e ora) e input_text (motivo)
    oraLimite: env("HA_ORA_LIMITE_ENTITY"),
    motivoOraLimite: env("HA_MOTIVO_ORA_LIMITE_ENTITY"),
    // Per il semaforo delle macchine, scritti da Casa: sole che resta oggi (input_number, kWh),
    // ora migliore più avanti (input_text "HH:MM" o vuoto) e rapporto reale/previsto (input_number)
    soleRestante: env("HA_SOLE_RESTANTE_ENTITY"),
    oraMigliore: env("HA_ORA_MIGLIORE_ENTITY"),
    rapportoSole: env("HA_RAPPORTO_SOLE_ENTITY"),
    // Lista delle faccende di ciascuno: HA_TODO_ANNA=todo.faccende_anna, ...
    todo: (persona: string) => env(`HA_TODO_${persona.toUpperCase()}`),
    // Lista della spesa di Home Assistant: se c'è, Casa usa questa e non quella di Grocy
    spesa: env("HA_SPESA_ENTITY"),
  },
  // Promemoria su Telegram: token del bot e, per ogni persona, la sua chat (TELEGRAM_CHAT_ANNA, ...)
  telegram: {
    token: env("TELEGRAM_BOT_TOKEN"),
    chat: (persona: string) => env(`TELEGRAM_CHAT_${persona.toUpperCase()}`),
  },
  // Assistente: webhook di n8n chiamato quando cambiano i giorni in sede, e token condiviso
  n8nWebhook: env("CASA_N8N_WEBHOOK_URL"),
  n8nToken: env("CASA_N8N_TOKEN"),
  // Token con cui Home Assistant legge l'ora limite delle macchine (GET /api/ha/macchine)
  tokenPerHa: env("CASA_HA_TOKEN"),
  // Ogni quanto girano i lavori periodici (sabato, stagioni, mesi, ritardi, liste di Home Assistant)
  intervalloLavoriMs: Number(process.env.CASA_JOBS_INTERVAL_MS ?? 2 * 60_000),
};
