# Runbook pilot fisico — Predator 01

## Identità

- unità: `predator-01`
- hostname: `affetta-predator-01.local`
- bridge: `octobridge-predator-01`
- stampante: Anycubic Predator con ugello reale 1,0 mm
- stato iniziale: sperimentale, stampa seriale disabilitata

## Sequenza obbligatoria

1. Etichettare Raspberry, alimentatore, microSD e cavo USB `PREDATOR-01`.
2. Scrivere e verificare l’immagine indicata nel piano SD.
3. Configurare hostname, SSH e rete; non riutilizzare credenziali di altri nodi.
4. Avviare senza collegare inizialmente la stampante.
5. Installare OctoPrint e generare la sua API key.
6. Copiare il bundle `predator-01` e inserire la API key nel relativo file segreto.
7. Eseguire `INSTALLA_NODO.sh`; il servizio viene installato senza avvio della stampa.
8. Collegare il cavo USB dati e registrare `/dev/serial/by-id/...`.
9. Verificare `curl http://localhost:8792/health` e la registrazione Server Lite.
10. Controllare manualmente homing, direzioni X/Y, quota Z, arresto e temperature.
11. Abilitare soltanto la modalità sperimentale e stampare un file breve e innocuo.
12. Durante una seconda prova spegnere Affetta dopo transfer e start verificati.
13. Riaccendere Affetta e confermare riconciliazione, esito e cronologia.

## Stop immediato

Interrompere il pilot in presenza di alimentazione instabile, reset USB, direzioni
errate, homing anomalo, movimento Z inatteso, riscaldamento non controllato,
perdita del file o stato non riconciliabile.

La promozione a produzione non è automatica.
