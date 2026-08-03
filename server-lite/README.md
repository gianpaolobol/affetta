# Affetta Server Lite P4.3

Fondazione local-first e offline-capable per un server Affetta intermittente.

## Obiettivi già implementati

- nessuna dipendenza da Redis, MinIO o Agent;
- persistenza locale SQLite e filesystem;
- avvio e spegnimento del server senza perdere cronologia e ultimo stato noto;
- riconciliazione automatica di tutte le stampanti all'avvio e a intervalli configurabili;
- modello di stato unificato per connessione, macchina e lavoro;
- percentuale, fase, tempi, layer, temperature, file attivo, errori e autonomia dal server;
- indicazione esplicita `can_shutdown`;
- adattatore di lettura Moonraker per FLSUN V400;
- adattatore di lettura OctoPrint per Raspberry Pi Zero 2 W + Anycubic Predator;
- dashboard diagnostica locale su porta 8791;
- test senza servizi esterni.

## Limiti intenzionali della P4.3

Questa milestone non invia ancora lavori reali alle stampanti e non sostituisce il flusso beta P4.2. Prepara il contratto persistente e la riconciliazione su cui saranno collegati:

1. invio Moonraker e OctoPrint;
2. adattatore Bambu LAN per X1C;
3. adattatore Snapmaker LAN per U1;
4. integrazione nella UI principale Affetta;
5. slicing interno del Server Lite.

Gli adattatori `bambu-lan` e `snapmaker-lan` sono riconosciuti ma restituiscono esplicitamente `adapter_not_implemented`: non viene simulata una compatibilità non ancora verificata.

## Avvio

Richiede Node.js 22.16 o successivo.

1. Copiare `config/local-server.example.json` in `config/local-server.json`.
2. Modificare indirizzi IP e abilitare solo le stampanti realmente configurate.
3. Per OctoPrint impostare la variabile `AFFETTA_OCTOPRINT_PREDATOR_API_KEY`.
4. Avviare:

```powershell
npm run server-lite:start
```

Dashboard diagnostica:

```text
http://127.0.0.1:8791/
```

Da altri dispositivi della LAN usare l'indirizzo IP del portatile, ad esempio:

```text
http://192.168.50.10:8791/
```

## Test

```powershell
npm run server-lite:test
npm run server-lite:smoke
```

## Sicurezza LAN

Il file di esempio usa `0.0.0.0` per rendere il servizio raggiungibile dalla LAN. Non esporre la porta 8791 direttamente a Internet. `api_token` può proteggere le operazioni di scrittura; la dashboard di questa milestone è destinata a una LAN privata e isolata.
