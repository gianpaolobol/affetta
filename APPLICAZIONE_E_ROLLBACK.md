# Applicazione e rollback Affetta 0.5.1

## Applicazione

1. Estrarre lo ZIP in una cartella di staging, ad esempio `C:\AFFETTA_UPDATE_0501`.
2. Non estrarre o eseguire l’aggiornamento direttamente da `C:\AFFETTA`.
3. Eseguire `APPLICA_AFFETTA_0501.cmd`.
4. Lo script crea `C:\AFFETTA_BACKUP_PRE_0501_<data_ora>`.
5. Vengono preservati `.env`, `data`, `runtime` e `node_modules`.
6. Avviare `C:\AFFETTA\AVVIA_AFFETTA.cmd`.
7. Eseguire i tre collaudi indicati nel README.

## Rollback

Eseguire `C:\AFFETTA\ROLLBACK_AFFETTA_0501.cmd`. Lo script usa il backup registrato in `data\last-update-backup.txt` e non elimina dati, runtime o dipendenze.
