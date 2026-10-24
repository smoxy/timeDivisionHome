# Quale backend per l'app di casa

Situazione al 24 ottobre 2026. Grocy, Donetick e Vikunja sono stati analizzati leggendo il codice dei repository e le pagine di release, issue e documentazione. Le 60 faccende di [faccende.yaml](faccende.yaml) sono state verificate una per una sul modello dati di ciascuno.

## In breve

- **Nessuno dei tre accetterebbe una MR con una nuova interfaccia.**
  - Grocy dal febbraio 2026 non accetta più codice esterno.
  - Donetick e Vikunja accettano PR piccole e concordate prima, non la sostituzione della UI.
  - Quindi la UI nuova va costruita come **client separato** che parla con le API, non come fork. Così gli aggiornamenti dei backend restano gratis.
- **Per le faccende il backend migliore è Donetick**:
  - 43 faccende su 60 si esprimono così come sono, le altre con un adattamento, nessuna è impossibile;
  - API REST completa, webhook, integrazione ufficiale con Home Assistant;
  - aggiornato una settimana fa.
- **Per cibo e spesa il migliore è Grocy**: scorte con data di scadenza, liste della spesa, menù, promemoria per le manutenzioni. Per le faccende invece è debole: le date slittano, non manda notifiche e non ha webhook.
- **Vikunja è scartato**: solo 32 faccende su 60 entrano senza adattamenti, 11 sono impossibili, e non tiene lo storico delle cose fatte.

## Confronto

| | Grocy | Donetick | Vikunja |
|---|---|---|---|
| Ultima release | 4.7.1, 4 settembre 2026 | 0.1.83, 18 ottobre 2026 | 2.7.1, 20 ottobre 2026 |
| Manutentori | 1 | 1 molto attivo, più ~25 contributori occasionali | 1 |
| Licenza | MIT | AGPL-3.0 | AGPL-3.0, alcune funzioni a pagamento |
| Stack | PHP 8.5, Slim, template lato server | Go, Gin, GORM; React separato | Go, xorm; Vue nello stesso repo |
| Database | Solo SQLite | SQLite o Postgres | SQLite, MySQL, Postgres |
| Faccende che si esprimono così come sono / con un adattamento / impossibili | 39 / 21 / 0 | **43 / 17 / 0** | 32 / 17 / 11 |
| Come calcola la prossima scadenza | Dall'ultima volta fatta, quindi slitta | Dalla scadenza oppure dal completamento, a scelta | Intervallo in secondi, slitta di un'ora al cambio dell'ora legale |
| "2ª domenica del mese" | No, solo "giorno 14" | Sì | No |
| Settimana A/B | Sì, ma si scambia se la fai in anticipo | Sì | Sì |
| Persona diversa a seconda del giorno | No | No, rotazione sì | No |
| Notifiche | Nessuna | Telegram, Pushover, Discord, app | Promemoria via email e webhook |
| API | REST con specifica OpenAPI; le pagine però leggono direttamente il database | REST con 167 endpoint, token API, accesso OIDC | API v2 con OpenAPI, token con permessi |
| Webhook | No | Sì: attività creata, fatta, saltata, in scadenza | Sì, molti eventi |
| Home Assistant | Integrazione non aggiornata da 15 mesi, non si configura sulla 4.7 | Integrazione ufficiale e add-on | Solo via webhook |
| iPhone e iPad | App Grocy Mobile, aggiornata a settembre 2026 | App iOS (presenza sull'App Store da verificare) o PWA senza notifiche | PWA senza notifiche; con CalDAV in Promemoria |
| Cibo, spesa, menù | **Sì, completo, anche le scadenze** | No | No |
| Sabato (dal tramonto al tramonto) | No | No | No |
| Contributi esterni | **Non ne accetta** | Sì, previa discussione; la riforma delle ricorrenze è stata rifiutata | Sì, previa issue; richiede di dichiarare l'uso di AI |

Nessuno dei tre conosce il sabato, la fascia del fotovoltaico, la durata delle faccende o lo scambio dei giorni in sede. Questa parte va scritta comunque da voi, qualunque backend scegliate.

## Proposta

```
iPhone / iPad / PC
        │
   UI "Casa" (PWA nuova, vostra)
        │
   servizio "Casa" (piccolo backend vostro)
   ├── Donetick      faccende, storico, punti
   ├── Grocy         scorte, scadenze, spesa, menù
   └── Home Assistant  FusionSolar, previsione solare, notifiche sul telefono
```

- **Donetick e Grocy restano originali**, aggiornati dalle loro immagini Docker. Nessun fork da tenere allineato.
- **Il servizio "Casa"** fa quello che i backend non sanno fare:
  - **sabato**: calcola il tramonto del luogo di casa, sposta a dopo il tramonto del sabato o alla domenica le faccende che scadrebbero durante il sabato, e tace le notifiche in quella finestra;
  - **stagioni**: attiva e disattiva le faccende stagionali, per esempio il lavaggio dei pavimenti che a metà febbraio passa dalla domenica al venerdì;
  - **giorni in sede**: quando chi lavora in sede cambia giorno, ne scambia le faccende;
  - **mesi pari e dispari**: gestisce frigo, davanzali, cuscini e ciclo cura;
  - **fotovoltaico**: legge da Home Assistant la produzione FusionSolar, la batteria e la previsione, e suggerisce l'orario delle macchine;
  - **settimana tipo**: tiene gli orari di entrambi, letti da `faccende.yaml`.
- **Notifiche su iPhone tramite l'app Home Assistant**, da installare sui telefoni: funziona meglio della PWA, che su iOS non riceve notifiche push.
- **La UI nuova** è codice vostro dalla prima riga: la licenza la scegliete voi. Se riprendete pezzi della UI di Donetick, quella parte resta AGPL. Il repo pubblico va bene in entrambi i casi.
- **Contributi upstream realistici**: solo su Donetick, piccoli e proposti prima in una Discussion. Per esempio il filtro dei mesi per le regole "N-esimo giorno della settimana", che oggi viene ignorato.

## Cosa sta nelle prime 8 ore

1. Docker Compose con Donetick e Grocy dietro il vostro dominio (circa 30 minuti).
2. Import di `faccende.yaml` in Donetick tramite API (circa 1 ora).
3. Servizio "Casa": sabato, stagioni, mesi pari e dispari, giorni in sede, lettura da Home Assistant (circa 3 ore).
4. UI per telefono con tre schermate: Oggi divisa per persona, Settimana a griglia, Spesa sulla lista di Grocy. Fatto e salta per ogni faccenda, avviso del tramonto (circa 3 ore e 30).

Restano fuori, per dopo:
- la UI per scorte, ricette e menù: nel frattempo su iPhone e iPad c'è Grocy Mobile;
- i punti e le statistiche;
- l'avvio automatico delle macchine da Home Assistant.

## Alternative valutate e scartate

- **Fork di Grocy con UI nuova**: il manutentore non accetta contributi, quindi il fork resterebbe vostro per sempre. Le ricorrenze delle faccende vivono in viste SQL che una migrazione upstream può sovrascrivere. Usato solo per il cibo, così com'è, va benissimo.
- **Vikunja**: ricorrenze troppo povere per questo calendario e nessuno storico delle cose fatte. Il supporto alle regole standard (RRULE) è in una PR ferma da 4 mesi, rimandata alla versione 3.0.
- **Mealie al posto di Grocy**: ha un'ottima integrazione con Home Assistant, ma non gestisce le scadenze dei cibi.
- **Tandoor**: ha le API migliori e le scadenze, ma la licenza include la Commons Clause.
- **KitchenOwl**: ha l'app iOS, ma API ancora in lavorazione e token senza scadenza.
- **Homechart**: non è più open source.
- **Backend scritto da zero**: con le vostre regole sarebbe anche il più semplice, ma vi perdereste notifiche, storico, app e integrazione con Home Assistant già pronti. Resta il piano B se Donetick dovesse fermarsi.

## Fonti

- Grocy: [repository](https://github.com/grocy/grocy), [release](https://github.com/grocy/grocy/releases), [Grocy Mobile per iOS](https://github.com/supergeorg/Grocy-SwiftUI), [integrazione Home Assistant](https://github.com/custom-components/grocy) e i problemi aperti [#363](https://github.com/custom-components/grocy/issues/363) e [#364](https://github.com/custom-components/grocy/issues/364).
- Donetick: [backend](https://github.com/donetick/donetick), [frontend](https://github.com/donetick/frontend), [release](https://github.com/donetick/donetick/releases), [integrazione Home Assistant](https://github.com/donetick/donetick-hass-integration), la richiesta delle regole RRULE [#653](https://github.com/donetick/donetick/issues/653).
- Vikunja: [repository](https://github.com/go-vikunja/vikunja), [PR RRULE #3071](https://github.com/go-vikunja/vikunja/pull/3071), [CalDAV](https://vikunja.io/docs/caldav/).
- FusionSolar in Home Assistant: [tijsverkoyen/homeassistant-fusionsolar](https://github.com/tijsverkoyen/homeassistant-fusionsolar), [olibos/Home-Assistant-FusionSolar-OpenApi](https://github.com/olibos/Home-Assistant-FusionSolar-OpenApi/).
- KitchenOwl: [app iOS](https://apps.apple.com/app/kitchenowl/id1557453670).
