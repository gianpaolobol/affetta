# Build report — Affetta OctoBridge Zero Snapshot P4.4

## Baseline

- repository: `gianpaolobol/affetta`;
- branch: `main`;
- baseline richiesta: commit `6da855e` (P4.3 Server Lite local-first);
- applicazione prevista: nuovo commit locale, nessun push automatico.

## Artefatto prodotto

È stato prodotto un package sorgente/installatore riproducibile. Non è stata prodotta un'immagine SD preinstallata e non è stato dichiarato alcun collaudo hardware.

## Componenti

- companion Python senza dipendenze runtime esterne;
- OctoPrint core fissato alla versione indicata in `requirements-octoprint.txt`, avviato in safe mode permanente;
- plugin di terze parti disabilitati, timelapse spento e hook G-code nulli;
- API HTTP autenticata;
- storage locale per job/eventi/immagini;
- doppia verifica SHA-256;
- monitor e riconciliazione;
- snapshot 0/25/50/75/100 e terminali anomali;
- live temporaneo;
- catalogo completo del laboratorio con blocchi espliciti;
- installer/uninstaller Raspberry Pi OS;
- systemd, Wi-Fi, diagnostica e collaudo;
- adattatore Server Lite;
- applicatore e rollback Windows.

## Test eseguiti nell'ambiente di generazione

- compilazione sintattica di tutti i moduli Python;
- 13 test unitari Python su storage, integrità, avvio, snapshot, annullamento e riconciliazione;
- 2 test Node sull'adattatore Server Lite e sul trasferimento byte-per-byte;
- verifica sintattica Bash degli script di installazione e diagnostica;
- parsing dei file JSON e degli schemi;
- revisione statica dell’applicatore PowerShell e allineamento ai punti di estensione della P4.3 pubblicata.

## Test non eseguibili nell'ambiente di generazione

- esecuzione dell’applicatore PowerShell su Windows (PowerShell non disponibile nell’ambiente Linux di generazione);
- installazione reale delle dipendenze ARMv6;
- boot Raspberry Pi OS sul Pi Zero V1.3;
- rilevamento MT7601U;
- camera CSI;
- connessione seriale reale;
- stampa fisica;
- spegnimento/riaccensione reale di Affetta Server;
- live durante una stampa lunga;
- prove di sottotensione e back-powering.

## Stato finale

```text
release_channel: experimental
production_ready: false
hardware_validation: pending
```
