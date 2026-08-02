# Affetta 0.5.2 — Thing-O-Matic / X3G

## Aggiunte

- profilo pubblico `Thing-O-Matic`;
- estrusore Mk6 singolo, ugello 0,35 mm e filamento 2,85 mm;
- firmware Sailfish, elettronica Gen 4 / ATmega 2560;
- volume prudenziale 100 × 100 × 100 mm;
- materiali PLA, ABS, PETG e TPU;
- profili cautelativi per PETG e TPU;
- pipeline `CuraEngine → G-code intermedio → GPX t6 → X3G`;
- rilevamento del motore GPX tramite `GPX_BIN`;
- download con estensione `.x3g` e MIME binario;
- unità privata `thing-o-matic-01`, esclusa dal routing produttivo finché non viene collaudata.

## Sicurezza

Il profilo consente la generazione X3G, ma resta sperimentale. La macchina non viene assegnata automaticamente agli ordini commerciali finché `production_ready` rimane `false`.

GPX non è incluso nel pacchetto. Installare una build Windows ufficiale/attendibile in:

`C:\AFFETTA_RUNTIME\engines\gpx\gpx.exe`

e poi eseguire `CONFIGURA_GPX_AFFETTA.cmd`.
