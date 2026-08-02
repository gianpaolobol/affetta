# P3.2 — Correzione migrazioni Docker

## Errore rilevato

Il primo collaudo live ha avviato correttamente PostgreSQL, Redis e MinIO, ma
`backend-migrate` è terminato con codice 1. Il runtime compilato si trova in
`/app/backend/dist/src`, mentre il Dockerfile copia gli SQL in
`/app/backend/migrations`. Il resolver precedente cercava invece
`/app/backend/dist/migrations`.

## Correzione

- nuovo resolver `resolveMigrationsDirectory`;
- override `AFFETTA_MIGRATIONS_DIR`;
- valore Compose esplicito `/app/backend/migrations`;
- due test dedicati;
- `--force-recreate` nel collaudatore live;
- stato e log Compose stampati anche se `docker compose up` fallisce.

## Ripresa del collaudo

La configurazione `backend/.env` e i volumi Docker esistenti devono essere
conservati. Dopo l'applicazione della patch è sufficiente rieseguire:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File "C:\AFFETTA_GITHUB_0412\backend\PREPARA_E_COLLAUDA_P3_LIVE.ps1" `
  -RepoPath "C:\AFFETTA_GITHUB_0412"
```
