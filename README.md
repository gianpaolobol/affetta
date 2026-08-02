# Affetta 0.5.2 — Thing-O-Matic e output X3G

Affetta 0.5.1 corregge la separazione tra modelli stampante pubblici e funzioni interne di Stampa3DBologna, oltre alla rappresentazione dei piani circolari delle stampanti delta.

## Novità principali

- `Profilo automatico laboratorio`: presente internamente, non visualizzato nella lista stampanti;
- `Profilo stima rapida Kiri:Moto`: presente internamente e usato solo per la stima preliminare;
- piani circolari reali nel viewer per Predator, V400, Delta WASP 2040, 2040 PRO e Turbo/Turbo2;
- profili pubblici LulzBot TAZ 4, TAZ 5, TAZ 6 e Mini prima generazione;
- unità private del laboratorio collegate ai modelli reali;
- `Prusa i3 autocostruita` rinominata senza suffisso;
- 68 test automatici superati e 327 profili laboratorio verificati staticamente.

## Installazione Windows

1. Estrai il pacchetto in una cartella diversa da `C:\AFFETTA`, ad esempio `C:\AFFETTA_UPDATE_0501`.
2. Esegui `APPLICA_AFFETTA_0501.cmd` dalla cartella estratta.
3. Avvia `C:\AFFETTA\AVVIA_AFFETTA.cmd`.
4. Esegui `C:\AFFETTA\COLLAUDO_FORENSE_AFFETTA.cmd`.
5. Esegui `C:\AFFETTA\COLLAUDA_PROFILI_LABORATORIO.cmd`.
6. Esegui `C:\AFFETTA\COLLAUDA_MOTORI_PARCO_MACCHINE.cmd`.

L’installer preserva `.env`, `data`, `runtime` e `node_modules` e crea `C:\AFFETTA_BACKUP_PRE_0501_<data_ora>`.

## Stato produttivo

X1C e Snapmaker U1 restano abilitate. Le nuove unità LulzBot e delta restano `production_ready=false` fino al collaudo reale del motore e alla stampa fisica.


## Thing-O-Matic

La versione 0.5.2 aggiunge la pipeline CuraEngine → GPX t6 → X3G per la Thing-O-Matic Mk6/Sailfish. I profili PLA, ABS, PETG e TPU sono utilizzabili ma sperimentali; la macchina resta esclusa dal routing produttivo automatico fino al collaudo fisico.

## Stato Thing-O-Matic

La generazione X3G è funzionante, ma il collaudo fisico è ancora pendente.
La macchina resta sperimentale e non disponibile per il routing produttivo automatico.

Vedi: `docs/THING_O_MATIC_PHYSICAL_VALIDATION_PENDING.md`
