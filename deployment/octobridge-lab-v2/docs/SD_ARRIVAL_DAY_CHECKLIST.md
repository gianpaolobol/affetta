# Checklist arrivo microSD — venerdì 7 agosto 2026

## Prima della scrittura

- associare una SD a una sola unità e applicare l’etichetta;
- controllare capacità dichiarata e assenza di errori del supporto;
- partire dal pilot `predator-01`, non preparare dodici nodi insieme;
- verificare checksum dell’immagine con `Verify-OctoPiImage.ps1`;
- conservare la microSD originale o una copia prima di modifiche irreversibili.

## Raspberry Pi Imager

- hostname `affetta-predator-01`;
- SSH abilitato;
- utente e password unici, non inclusi in Git;
- Wi-Fi 2,4 GHz quando richiesto dal modello/adattatore;
- fuso orario `Europe/Rome`;
- layout tastiera italiano;
- espulsione sicura dopo la verifica.

## Primo avvio

- avviare inizialmente senza stampante USB;
- registrare modello, revisione, seriale Raspberry, MAC e IP;
- verificare alimentazione e temperatura;
- aggiornare `node-plan.json` nel runtime, non nei manifest Git;
- installare OctoPrint e creare una API key per quel solo nodo;
- usare il bundle pre-generato `predator-01`.

## Prima stampa

La stampa resta vietata finché non sono verificati seriale stabile, homing,
direzioni, quota Z, temperature, arresto e controllo manuale dell’operatore.
