# Affetta P3.1 — Collaudo live Docker su Windows

## Obiettivo

Verificare con servizi reali:

- migrazione PostgreSQL;
- coda Redis;
- bucket MinIO;
- readiness del backend;
- URL S3 firmato raggiungibile da Windows;
- upload e verifica SHA-256;
- idempotenza e cancellazione job;
- persistenza dopo riavvio del backend.

## Avvio automatico

Da PowerShell:

```powershell
Set-Location C:\AFFETTA_GITHUB_0412
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File ".\backend\PREPARA_E_COLLAUDA_P3_LIVE.ps1" `
  -RepoPath "C:\AFFETTA_GITHUB_0412"
```

Lo script crea `backend\.env` solo se assente. Le credenziali non vengono
inserite nel report né versionate da Git.

## Endpoint locali

```text
Backend:       http://127.0.0.1:8790
MinIO API:     http://127.0.0.1:9000
MinIO console: http://127.0.0.1:9001
```

Questi endpoint sono intenzionalmente legati al loopback.

## Arresto senza perdere dati

```powershell
Set-Location C:\AFFETTA_GITHUB_0412\backend
docker compose --project-name affetta-p3 stop
```

## Riavvio

```powershell
Set-Location C:\AFFETTA_GITHUB_0412\backend
docker compose --project-name affetta-p3 up -d
```

## Eliminazione completa dell'ambiente di sviluppo

Questo comando elimina anche database, coda e oggetti MinIO:

```powershell
Set-Location C:\AFFETTA_GITHUB_0412\backend
docker compose --project-name affetta-p3 down --volumes
```

Usarlo soltanto quando la perdita dei dati di test è intenzionale.

## Limite di sicurezza

Il profilo P3.1 è per collaudo locale. Prima di collegare un Agent su un altro
computer servono TLS/HTTPS, certificati attendibili, firewall e host storage
esplicitamente autorizzati.
