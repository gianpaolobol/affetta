# Collaudo fisico — Affetta OctoBridge Zero Snapshot

La build resta `experimental` e `production_ready: false` fino al completamento documentato delle prove. Eseguire inizialmente su una sola stampante, preferibilmente con un oggetto breve e non critico.

## A. Hardware e sistema

- [ ] Raspberry Pi Zero V1.3 identificato correttamente come ARMv6.
- [ ] Alimentatore stabile 5 V / 2,5 A e cavo corto di buona sezione.
- [ ] Nessun back-powering dalla USB stampante; usare power blocker se necessario.
- [ ] `vcgencmd get_throttled` non segnala sottotensione attuale o storica.
- [ ] MT7601U rilevato da `lsusb` e modulo `mt7601u` caricato.
- [ ] Riconnessione Wi-Fi verificata dopo riavvio e dopo assenza del router.
- [ ] Camera CSI rilevata e snapshot statico leggibile.
- [ ] Porta seriale stabile e permessi `dialout` corretti.

## B. Installazione e sicurezza

- [ ] OctoPrint si avvia come servizio e ascolta solo su `127.0.0.1:5000`.
- [ ] OctoBridge risponde su `8792` e rifiuta token errati.
- [ ] OctoPrint risulta avviato in safe mode.
- [ ] Timelapse e hook G-code OctoPrint risultano disattivati/nulli.
- [ ] Nessun plugin di slicing o plugin pesante installato.
- [ ] Configurazione indica `experimental` e `production_ready: false`.
- [ ] Profilo stampante corretto; modelli bloccati non possono essere abilitati sul seriale.

## C. Store-and-forward

- [ ] Upload di un G-code breve con SHA-256 noto.
- [ ] File incompleto rifiutato.
- [ ] Hash errato rifiutato.
- [ ] Avvio rifiutato nello stato `created` o `staged`.
- [ ] Dimensione della copia OctoPrint verificata.
- [ ] SHA-256 della copia scaricata da OctoPrint identico all'originale.
- [ ] Avvio possibile solo dopo stato `transferred`.
- [ ] Nuovi upload e trasferimenti vengono rifiutati mentre una stampa è attiva.
- [ ] Confronto byte-per-byte del file originale, staged e OctoPrint.

## D. Stampa e snapshot

- [ ] `00_pre_print.jpg` prima del comando di avvio.
- [ ] `01_progress_25.jpg` una sola volta.
- [ ] `02_progress_50.jpg` una sola volta.
- [ ] `03_progress_75.jpg` una sola volta.
- [ ] `04_completed.jpg` a esito esplicito completato.
- [ ] `04_failed.jpg` su fallimento esplicito.
- [ ] `04_cancelled.jpg` dopo annullamento richiesto e confermato.
- [ ] `04_interrupted.jpg` su interruzione seriale esplicita.
- [ ] Nessuna immagine terminale falsa quando l'esito non è verificabile.

## E. Autonomia e riconciliazione

- [ ] Spegnere Affetta Server dopo l'avvio; la stampa continua sul Pi.
- [ ] Riaccendere Affetta durante la stampa; stato, file e percentuale si riallineano.
- [ ] Spegnere Affetta fino al termine; alla riaccensione viene letto l'esito registrato da OctoPrint.
- [ ] Simulare dati insufficienti; Affetta mostra `outcome_unknown`.
- [ ] Eventi e immagini rimangono sul Pi finché Affetta non invia `sync-ack`.
- [ ] Dopo retention e sincronizzazione completa vengono eliminati solo payload locali, non metadata/eventi.

## F. Live temporaneo

- [ ] Sessione predefinita 45 secondi.
- [ ] Richiesta oltre 120 secondi limitata automaticamente.
- [ ] Una sola sessione contemporanea.
- [ ] Stop automatico alla scadenza.
- [ ] Stop automatico quando deve essere acquisito uno snapshot.
- [ ] Nessun rallentamento, disconnessione o errore seriale durante live.

## G. Durata

- [ ] Stampa breve 10–20 minuti.
- [ ] Stampa di 2 ore.
- [ ] Stampa di 8–12 ore.
- [ ] Riavvio del router durante una stampa senza perdita del processo seriale.
- [ ] Controllo temperatura, memoria, swap e log al termine.
- [ ] Confronto qualità con lo stesso G-code stampato da SD/controller noto.

## Esito

Registrare per ogni prova: data, Pi, alimentatore, adattatore, camera, stampante, firmware, porta, baud rate, file e SHA-256, risultato, log diagnostico e anomalie. Nessun singolo test autorizza il passaggio a produzione dell'intera build.
