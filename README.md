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
  - dopo un cambio dei giorni in sede chiede a un assistente (un workflow n8n con un LLM) qualche spostamento per riequilibrare il carico, e applica solo le proposte che rispettano le regole.

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

**Liste per persona.** In Home Assistant si crea una "Lista di cose da fare locale" per persona, per esempio "Faccende Anna", e la si indica in `HA_TODO_<NOME>`. Ogni due minuti Casa ci mette le faccende di oggi e quelle rimaste indietro, toglie quelle fatte altrove e segna fatte in Donetick quelle spuntate in Home Assistant. Le voci aggiunte a mano nella lista non vengono toccate. In una dashboard si può dare a ciascuno una vista con la propria lista, visibile solo a quell'utente.

**Notifiche su iPhone.** La PWA su iOS non riceve notifiche push. Le notifiche arrivano da Donetick, che può mandarle su Telegram o Pushover, oppure tramite l'integrazione Donetick di Home Assistant e l'app Home Assistant sul telefono.

## Giorni in sede e assistente

Chi ha `sede` in `meta.orari` sceglie in Casa, nella settimana, i propri giorni in sede. Al salvataggio Casa:

1. porta le voci con `sede: dentro` nei nuovi giorni in sede e quelle con `sede: fuori` negli altri;
2. sposta le sue faccende, e quelle da fare insieme, che cadono nella fascia `fuori_casa_in_sede` di un nuovo giorno in sede al giorno che torna da remoto, alla stessa ora;
3. se `CASA_N8N_WEBHOOK_URL` è impostato, manda a n8n la settimana con i carichi e i vincoli. Il workflow in `n8n/` chiede all'LLM al massimo 5 proposte e le rimanda a `POST /api/automazioni/proposte`, autenticata con `CASA_N8N_TOKEN`.

Casa controlla ogni proposta (sabato, ore fuori casa, impegni, faccende da fare insieme) prima di applicarla. Un cambio di persona vale per una volta: finita l'occorrenza, la faccenda torna a chi l'aveva prima. Le modifiche applicate e scartate si vedono nella settimana.

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
