# Affetta Backend 0.3.0 — P4.2

Backend Affetta per account beta, Agent, job, lease, coda, artefatti e download
verificati. Il backend non esegue slicing: coordina Affetta locale tramite
Agent Windows.

## Architettura

- PostgreSQL: tenant, account, quote, Agent, job, eventi, lease e metadati;
- Redis: coda dei job pronti;
- storage S3 compatibile: input/output e URL firmati;
- Agent Windows: polling in uscita e collegamento ad Affetta locale;
- contratti: `affetta.job.v1`, `affetta.result.v1`,
  `affetta.agent-capabilities.v1`.

## Beta web locale

```text
http://127.0.0.1:8790/beta/
```

P4.2 comprende:

- registrazione, verifica email, login e logout;
- tenant personale e profilo costi;
- pairing monouso dell’Agent personale;
- upload browser con SHA-256 e PUT firmato;
- creazione job idempotente con routing automatico;
- enforcement transazionale delle quote Free;
- polling, cancellazione e download G-code verificato;
- nessun comando inviato alla stampante fisica.

## Limiti Free predefiniti

```text
5 job/giorno
50 MB/input
24 ore retention
1 Agent
```

Sono configurabili tramite `AFFETTA_BETA_FREE_*` e applicati dal backend.

## Endpoint beta

```text
GET   /beta/
GET   /v1/beta/limits
POST  /v1/beta/register
POST  /v1/beta/verify-email
POST  /v1/beta/login
GET   /v1/beta/me
PATCH /v1/beta/me/cost-profile
POST  /v1/beta/logout
GET   /v1/beta/agents
POST  /v1/beta/agents/pairing-code
POST  /v1/beta/agents/{id}/revoke
POST  /v1/beta/artifacts/prepare-upload
POST  /v1/beta/artifacts/{id}/upload-complete
GET   /v1/beta/jobs
POST  /v1/beta/jobs
GET   /v1/beta/jobs/{id}
POST  /v1/beta/jobs/{id}/cancel
GET   /v1/beta/jobs/{id}/download
```

Gli endpoint Agent e amministrativi P3 restano disponibili come documentato in
`/openapi.json`.

## Stack locale Docker

Con `backend/.env` già configurato:

```powershell
Set-Location C:\AFFETTA_GITHUB_0412\backend
docker compose --project-name affetta-p3 build
docker compose --project-name affetta-p3 up -d
```

Backend e MinIO sono pubblicati soltanto su `127.0.0.1` per impostazione
predefinita.

## Collaudo P4.2

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File "C:\AFFETTA_GITHUB_0412\backend\p4-2\PREPARA_E_COLLAUDA_P4_2_BETA.ps1" `
  -RepoPath "C:\AFFETTA_GITHUB_0412"
```

Il collaudo usa un account temporaneo e un Agent temporaneo, verifica il file
scaricato con SHA-256 e revoca l’Agent. Non stampa nulla.

## Sicurezza e stato

- password derivate con scrypt;
- token email, sessione, API e Agent memorizzati come hash;
- isolamento per organizzazione su tutte le risorse;
- quote aggiornate atomicamente con la creazione del job;
- verifica S3 di checksum e dimensione;
- solo profili `production_ready` quando richiesto;
- CORS MinIO limitato all’origine beta locale configurata;
- `AFFETTA_BETA_EXPOSE_DEV_TOKENS=true` è ammesso solo su loopback.

La beta non è ancora pronta per Internet: mancano HTTPS pubblico, SMTP reale,
reset password/2FA, rate limiting distribuito, protezioni antiabuso,
antivirus/sandbox CAD e hardening operativo dello storage.
