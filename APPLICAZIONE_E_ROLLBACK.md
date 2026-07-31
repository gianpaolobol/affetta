# Applicazione e rollback Affetta 0.4.12

## Applicazione

1. Chiudere Affetta.
2. Estrarre lo ZIP in una cartella diversa da `C:\AFFETTA`, per esempio `C:\AFFETTA_UPDATE_0412`.
3. Eseguire `APPLICA_AFFETTA_0412.cmd` dalla cartella estratta.
4. Lo script crea `C:\AFFETTA_BACKUP_PRE_0412_<data_ora>`.
5. Restano invariati `.env`, `data`, `runtime` e `node_modules`.
6. Avviare `C:\AFFETTA\AVVIA_AFFETTA.cmd`.
7. Eseguire `C:\AFFETTA\COLLAUDO_FORENSE_AFFETTA.cmd`.

## Rollback

Eseguire `C:\AFFETTA\ROLLBACK_AFFETTA_0412.cmd`.

Il rollback usa il percorso memorizzato in `C:\AFFETTA\data\last-update-backup.txt` e non elimina dati, runtime o dipendenze.
