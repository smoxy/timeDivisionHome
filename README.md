# Casa

Un'app per una casa condivisa: faccende, settimana, spesa e fotovoltaico, con il riposo del sabato dal tramonto al tramonto.

- **Donetick** tiene le faccende, lo storico e le notifiche.
- **Grocy** tiene la lista della spesa, e più avanti dispensa, scadenze e menù.
- **Casa** è il servizio di questo repository. È un'interfaccia per telefono più un piccolo backend che fa quello che gli altri due non sanno fare:
  - sposta dopo il tramonto del sabato tutto quello che scadrebbe durante il sabato;
  - attiva e disattiva le faccende stagionali, guardando il tramonto del venerdì;
  - rimette nei mesi giusti le faccende dei mesi pari e dispari e quelle trimestrali;
  - tiene i giorni in sede di ogni settimana: chi lavora in sede li sceglie in Casa, le faccende legate alla sede (campo `sede`) li seguono, e le sue faccende che cadono mentre è fuori casa passano al giorno che torna da remoto;
  - legge da Home Assistant la produzione del fotovoltaico e suggerisce quando far partire le macchine;
  - riporta al giorno dopo le faccende non fatte, una volta sola: una faccenda fatta in ritardo non ricompare subito, e tra faccende con lo stesso `concetto` rimaste indietro se ne vede una;
  - tiene una lista per persona in Home Assistant: ci mette le faccende di oggi e quelle rimaste indietro, e quando una voce viene spuntata la segna fatta in Donetick a nome di chi l'ha spuntata. Una faccenda personale spuntata da un'altra persona torna da fare;
  - dopo un cambio dei giorni in sede chiede a un assistente (un workflow n8n con un LLM) qualche spostamento per riequilibrare il carico, e applica solo le proposte che rispettano le regole;
  - tiene fuori dal tardo pomeriggio le macchine ad alto consumo (lavatrice, asciugatrice, lavastoviglie, forno), quando la produzione del fotovoltaico cala;
  - salta un giorno di una faccenda per tutti (la palestra annullata, gli ospiti);
  - scrive su Telegram a chi lo vuole: al mattino le faccende di oggi, la sera quelle che restano, la sera tardi il memo di domani.

Donetick e Grocy restano originali, aggiornati dalle loro immagini Docker: non sono fork.

## Cartelle

| Percorso | Cosa contiene |
|---|---|
| `faccende.esempio.yaml` | Catalogo di esempio con dati inventati: chi fa cosa, quando e quanto dura |
| `faccende.yaml` | Il catalogo vero di casa. Si crea copiando l'esempio e resta fuori dal repository |
| `confronto-backend.md` | Perché Donetick e Grocy |
| `docker-compose.yml` | Donetick, Grocy e Casa, senza porte pubblicate: si raggiungono dal reverse proxy |
| `compose.porte.yaml` | Solo per prove in locale: apre le porte su 127.0.0.1 |
| `n8n/` | Il workflow dell'assistente da importare in n8n, con le istruzioni |
| `casa/src` | Il servizio Casa (Node 24, TypeScript eseguito direttamente) |
| `casa/web` | L'interfaccia (React e Vite), installabile sul telefono come app |
| `casa/test` | Test del calendario, dei tramonti e del sabato, sul catalogo di esempio |

`faccende.yaml` dice chi è in casa e quando: per questo è escluso dal repository, insieme a `.env` e `data/`.

## Installazione sul server

1. Creare il catalogo di casa partendo dall'esempio, e adattarlo: persone, luogo (latitudine e longitudine servono per il tramonto), faccende.

   ```bash
   cp faccende.esempio.yaml faccende.yaml
   ```

2. Copiare `.env.example` in `.env`. Generare due segreti con `openssl rand -hex 32`, uno per `DONETICK_JWT_SECRET` e uno per `CASA_SECRET`. Poi creare la cartella dei dati di Casa:

   ```bash
   mkdir -p data/casa
   ```

3. Avviare Donetick e Grocy (in locale aggiungere `-f docker-compose.yml -f compose.porte.yaml`):

   ```bash
   docker compose up -d donetick grocy
   ```

4. **Donetick**, dal suo indirizzo sul proxy (in locale porta 2021):
   1. Chi farà da amministratore crea per primo il suo account.
   2. Le altre persone creano il loro e chiedono di entrare con il codice di invito, che l'amministratore trova nelle impostazioni e poi accetta.
   3. Il nome visualizzato o lo username di ciascuno devono coincidere con i nomi in `meta.persone`.
   4. Ognuno crea un token API (Impostazioni, Token API) e lo mette in `DONETICK_TOKEN_<NOME>`, con il nome in maiuscolo.
   5. Infine mettere `DONETICK_SIGNUP_DISABLED=true`.
5. **Grocy**, dal suo indirizzo sul proxy (in locale porta 9283):
   1. Aprire la pagina una volta, così si crea il database.
   2. Entrare con admin / admin e **cambiare subito la password**.
   3. Creare una chiave API dal menu utente (Gestisci chiavi API) e metterla in `GROCY_API_KEY`.
6. Generare una password di Casa per persona e mettere gli hash in `CASA_PASSWORD_<NOME>`:

   ```bash
   docker compose run --rm casa node src/cli/password.ts
   ```

7. Importare le faccende. Prima la prova, che mostra cosa farebbe senza scrivere niente:

   ```bash
   docker compose run --rm casa node src/cli/importa.ts --prova
   ```

   Poi l'import vero:

   ```bash
   docker compose run --rm casa node src/cli/importa.ts
   ```

8. Avviare tutto:

   ```bash
   docker compose up -d
   ```

   Nessun servizio pubblica porte sull'host. Si agganciano alla rete Docker del reverse proxy indicata in `PROXY_NETWORK`, dove rispondono con i nomi `timedivision-casa:8080`, `timedivision-donetick:2021` e `timedivision-grocy:80`. Il proxy deve servirli in HTTPS, perché il cookie di sessione di Casa è `Secure`.

   Per provare in locale senza proxy e senza HTTPS, mettere `CASA_COOKIE_SECURE=false` e avviare così:

   ```bash
   docker compose -f docker-compose.yml -f compose.porte.yaml up -d
   ```

Su iPhone e iPad si apre l'indirizzo in Safari e si sceglie "Aggiungi alla schermata Home".

## Home Assistant e fotovoltaico

È facoltativo. Senza Home Assistant, Casa usa fasce di stagione: d'inverno 10:30–14:30, in mezza stagione 10–16, d'estate 9–17.

Con Home Assistant servono:
- `HA_URL` e un token di lunga durata in `HA_TOKEN` (profilo utente, Sicurezza), meglio di un utente non amministratore;
- le entità di potenza e batteria del vostro impianto, per esempio dall'integrazione FusionSolar;
- le entità del picco previsto, dall'integrazione Forecast.Solar.

Casa legge lo stato delle entità e, se configurate, aggiorna le liste delle faccende.

**Macchine e fotovoltaico.** Le macchine ad alto consumo (lavatrice, asciugatrice, lavastoviglie, forno, vedi `meta.macchine`) devono aver finito prima che la produzione cali. L'ora limite non è fissa: ogni giorno Casa chiede a Home Assistant la previsione di Forecast.Solar (`energy/solar_forecast`, via websocket) e la fissa alla fine dell'ultima ora in cui si prevedono almeno `soglia_kw` kW (1,5 se non indicata). La previsione è corretta con quanto il sole ha reso davvero stamattina, letto da `HA_PV_TODAY_ENTITY` (rapporto tra reale e previsto, tra 0,5 e 1,5, solo dopo che è passata almeno un'ora di sole). Se nessuna ora raggiunge la soglia, Casa scrive che oggi il sole non basta. Se la previsione manca vale l'ora di riserva `entro`. L'ora limite compare in Oggi, nel promemoria del mattino su Telegram e nel controllo delle proposte dell'assistente (per oggi). Si rilegge ogni 10 minuti.

Home Assistant la legge da `GET /api/ha/macchine`, con l'header `x-casa-token` uguale a `CASA_HA_TOKEN` (senza token valido, 401), per esempio con un sensore REST:

```yaml
rest:
  - resource: https://casa.example.com/api/ha/macchine
    headers:
      x-casa-token: !secret casa_ha_token
    scan_interval: 600
    sensor:
      - name: "Macchine: ora limite"
        value_template: "{{ value_json.istante }}"
        device_class: timestamp
      - name: "Macchine: motivo"
        value_template: "{{ value_json.motivo }}"
```

La risposta è `{ oraLimite: "HH:MM" | null, istante: ISO | null, motivo, rapporto, entroRiserva }`; `istante` è `null` quando oggi il sole non basta o la previsione manca.

**Liste per persona.** In Home Assistant si crea una "Lista di cose da fare locale" per persona, per esempio "Faccende Anna", e la si indica in `HA_TODO_<NOME>`. Ogni due minuti Casa ci mette le faccende di oggi e quelle rimaste indietro, toglie quelle fatte altrove e segna fatte in Donetick quelle spuntate in Home Assistant. Le voci aggiunte a mano nella lista non vengono toccate. In una dashboard si può dare a ciascuno una vista con la propria lista, visibile solo a quell'utente.

**Notifiche su iPhone.** La PWA su iOS non riceve notifiche push. Le notifiche arrivano da Donetick, che può mandarle su Telegram o Pushover, oppure tramite l'integrazione Donetick di Home Assistant e l'app Home Assistant sul telefono.

## Giorni in sede e assistente

Chi ha `sede` in `meta.orari` sceglie in Casa, nella settimana, i propri giorni in sede. Al salvataggio Casa:

1. porta le voci con `sede: dentro` nei nuovi giorni in sede, quelle con `sede: fuori` negli altri e quelle con `sede: vigilia` alla sera prima di ogni giorno in sede;
2. sposta le sue faccende, e quelle da fare insieme, che cadono nella fascia `fuori_casa_in_sede` di un nuovo giorno in sede al giorno che torna da remoto, alla stessa ora;
3. confronta il carico di ogni giorno con quello della settimana solita. Se qualcuno ha almeno 15 minuti più del solito e più dell'altra persona, sceglie le sue faccende di quel giorno che l'altra può fare alla stessa ora;
4. se ci sono candidati e `CASA_N8N_WEBHOOK_URL` è impostato, li manda a n8n. Il workflow in `n8n/` fa scegliere all'LLM al massimo 5 faccende da passare, con il motivo, e le rimanda a `POST /api/automazioni/proposte`, autenticata con `CASA_N8N_TOKEN`. Il modello gira senza ragionamento (`reasoning_effort: none`): con il ragionamento acceso un modello piccolo esaurisce i token prima di rispondere.

Casa controlla ogni proposta (sabato, ore fuori casa, impegni, faccende da fare insieme) prima di applicarla. Un cambio di persona vale per una volta: finita l'occorrenza, la faccenda torna a chi l'aveva prima. Le modifiche applicate e scartate si vedono nella settimana.

## Macchine e fotovoltaico

Se la produzione cala a un'ora precisa, in `meta.macchine` si scrive il limite e per quanto vale (poi si potrà sostituire con un dato dall'impianto):

```yaml
meta:
  macchine:
    entro: "15:30"
    fino_a: 2027-03-31
    durata_minuti: {lavatrice: 120, asciugatrice: 120, lavastoviglie: 150, forno: 90}
```

Le voci che usano una macchina dicono quando parte (l'ultima partenza, se ne ha più d'una): `macchine: {lavatrice: "09:00", asciugatrice: "11:30"}`. Se una partenza più la durata supera il limite, l'import stampa un avviso, e l'assistente non sposta quella voce oltre il limite. Se la partenza è programmata (la lavastoviglie alle 11:00), si scrive l'ora programmata, non quella in cui si carica.

## Saltare un giorno

Per togliere una faccenda in un giorno solo, per tutti (palestra annullata, ospiti):

```bash
docker compose exec casa node src/cli/salta.ts palestra-gio 2026-11-05
docker compose exec casa node src/cli/salta.ts palestra-gio 2026-11-05 --ripristina
```

Il giorno sparisce dalla settimana e Donetick porta la faccenda alla volta dopo. Lo stato sta in `data/casa/stato.json` e si ripulisce da solo.

## Promemoria su Telegram

Con un bot Telegram Casa scrive a ogni persona che ha una chat: alle 9:00 le faccende di oggi e quelle rimaste indietro, alle 18:00 quello che non è ancora stato fatto e quello che resta della giornata, alle 22:00 il memo di domani. Non parte niente se non c'è niente da dire, né nel sabato.

1. Crea il bot con @BotFather e metti `TELEGRAM_BOT_TOKEN` nel `.env` sul server.
2. Ogni persona apre il bot e preme Start.
3. `docker compose exec casa node src/cli/telegram.ts --chat` mostra i chat id: metti `TELEGRAM_CHAT_<PERSONA>` nel `.env` e riavvia Casa.
4. `--prova <persona>` manda un messaggio di prova, `--anteprima <persona> mattina|sera|domani` mostra il testo con i dati veri senza inviarlo.

Lo stato fatto o non fatto lo prende da Donetick; se Casa era ferma, un messaggio si recupera fino a 90 minuti dopo l'ora. Le cose rimaste indietro sono tante? Se ne mostrano le sei più recenti.

## Cambiare le faccende

Si modifica `faccende.yaml`; Casa lo rilegge da solo. Per portare le modifiche in Donetick:

```bash
docker compose run --rm casa node src/cli/importa.ts --aggiorna
```

Ogni faccenda importata porta nella descrizione un marcatore `[casa:id]`, che l'import usa per riconoscerla. Le faccende create a mano in Donetick non vengono toccate, salvo lo spostamento fuori dal sabato, che vale per tutte.

Le voci con `ogni: evento`, per esempio la camera per gli ospiti, entrano in Donetick senza data: la scadenza si fissa a mano quando serve.

## Sviluppo

```bash
cd casa && npm install
```

| Comando | Cosa fa |
|---|---|
| `npm run dev` | Servizio sulla porta 8080, legge `../.env` |
| `npm run dev:web` | Interfaccia con ricarica automatica, sulla porta 5173 |
| `npm test` | Test del calendario |
| `npm run typecheck` | Controllo dei tipi |
| `npm run build` | Compila l'interfaccia in `dist/web` |

## Licenza

Il codice di questo repository è rilasciato con licenza [MIT](LICENSE).

Donetick (AGPL-3.0) e Grocy (MIT) girano come servizi separati, dalle loro immagini ufficiali, e Casa ci parla solo tramite le loro API.
