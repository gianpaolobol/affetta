# ADR-009 — Affetta Server Lite local-first e intermittente

## Stato

Accettato per P4.3.

## Contesto

Affetta deve poter funzionare su un portatile locale non sempre acceso e senza connessione Internet. Dopo il trasferimento completo e l'avvio, il lavoro deve essere eseguito autonomamente dal controller della stampante. Alla riaccensione Affetta deve interrogare i dispositivi, riconciliare gli stati e aggiornare cronologia e dashboard.

## Decisione

Si introduce `server-lite`, separato dal backend cloud P4.2:

- database SQLite locale;
- nessun Redis, MinIO o Agent;
- polling e riconciliazione all'avvio;
- adattatori per famiglia di controller;
- modello normalizzato `affetta.printer-status.v1`;
- stato di dipendenza `server_required` o `device_autonomous`;
- nessuna inferenza positiva non supportata dal controller.

La stampa non deve essere trasmessa riga per riga dal portatile. I futuri adattatori di invio useranno store-and-forward: file completo al controller, verifica della ricezione, avvio e conferma dell'autonomia.

## Conseguenze

- il server può essere spento dopo la conferma di autonomia;
- la LAN e il controller della stampante devono restare accesi;
- al riavvio gli esiti non dimostrabili diventano `outcome_unknown`, non `completed`;
- la modalità cloud continuerà a usare l'infrastruttura P4.2/P4.x separata;
- l'interfaccia tecnica P4.3 è temporanea e non sostituisce la UI principale Affetta.
