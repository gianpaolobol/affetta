# Affetta Backend 0.2.0 — P4.1

Backend Affetta per coordinare account beta, Agent, job, lease, coda e artefatti. Non sostituisce Affetta locale e non esegue slicing.

## Architettura

- PostgreSQL: fonte autorevole di tenant, Agent, job, eventi, lease e metadati artefatti;
- Redis: coda dei job pronti e ordinamento per disponibilità/priorità;
- S3 compatibile: binari e URL firmati;
- Agent Windows: polling HTTPS in uscita;
- contratti P1: `affetta.job.v1`, `affetta.result.v1`, `affetta.agent-capabilities.v1`.

Il lease viene confermato nel database con un aggiornamento atomico. Redis accelera la selezione ma non può, da solo, autorizzare l'esecuzione di un job.

## Beta web P4.1

La fondazione della beta gratuita è disponibile su:

```text
http://127.0.0.1:8790/beta/
```

Comprende registrazione, verifica email tramite outbox, login, sessione bearer,
profilo costi personale e limiti Free. Il Compose locale può esporre il token
di verifica soltanto perché resta vincolato a `127.0.0.1`; non usare
`AFFETTA_BETA_EXPOSE_DEV_TOKENS=true` su Internet.

Il collegamento browser upload → job → download e l'enforcement delle quote
sono P4.2.

## Endpoint principali

```text
GET  /beta/
GET  /v1/beta/limits
POST /v1/beta/register
POST /v1/beta/verify-email
POST /v1/beta/login
GET  /v1/beta/me
PATCH /v1/beta/me/cost-profile
POST /v1/beta/logout
POST /v1/pairing-codes
POST /v1/agents/pair
POST /v1/agents/{id}/heartbeat
POST /v1/agents/{id}/lease
POST /v1/jobs
GET  /v1/jobs/{id}
POST /v1/jobs/{id}/ack
POST /v1/jobs/{id}/progress
POST /v1/jobs/{id}/complete
POST /v1/jobs/{id}/fail
POST /v1/jobs/{id}/cancel
POST /v1/artifacts/prepare-upload
POST /v1/artifacts/{id}/upload-complete
GET  /openapi.json
GET  /healthz
GET  /readyz
GET  /metrics
```

## Modalità memoria per sviluppo

```powershell
Set-Location backend
Copy-Item .env.example .env
$env:AFFETTA_BACKEND_MODE='memory'
$env:AFFETTA_ALLOW_INSECURE_MEMORY_DEFAULTS='true'
npm install
npm run build
npm test
npm start
```

Credenziali predefinite, solo in modalità memoria esplicitamente insicura:

```text
API key:      affetta-dev-api-key-change-me
Pairing code: AFFETTA-DEV-PAIR
```

## Stack locale Docker

1. Copiare `.env.example` in `.env` e cambiare tutte le credenziali.
2. Dalla cartella `backend`:

```powershell
docker compose build
docker compose up -d
```

Il compose usa PostgreSQL 18.4, Redis 8.8.1 e uno storage S3 compatibile MinIO per sviluppo. Prima della beta, fissare anche un digest immutabile per le immagini MinIO.

## Sicurezza

- API key, token Agent e token di sessione beta sono conservati come SHA-256;
- password beta derivate con scrypt e salt casuale;
- la tabella di verifica conserva il token come hash; l’outbox locale contiene il link di consegna a breve scadenza e non è ancora adatta a Internet;
- pairing code a scadenza e numero massimo di utilizzi;
- tenant isolation su tutte le entità;
- checksum SHA-256 verificato leggendo l'oggetto S3 dopo l'upload;
- lease con scadenza, rinnovo e controllo dell'Agent assegnato;
- `production_ready=false` escluso quando il job lo richiede;
- nessun path locale nei contratti pubblici;
- body JSON limitato;
- errori strutturati e correlation ID.

## Limiti correnti

- account beta disponibile; billing, recupero password, 2FA e worker SMTP non ancora inclusi;
- niente scheduler multi-piatto/fleet score avanzato;
- niente webhook;
- niente antivirus/CAD sandbox: previsto nella fase beta;
- la verifica S3 streaming è limitata da `S3_VERIFY_MAX_BYTES`;
- MinIO `latest` è accettabile soltanto per sviluppo: fissare tag e digest prima di ambienti condivisi.


## P3.1 deployment locale Windows/WSL2

P3.1 separa `S3_ENDPOINT`, usato dal backend dentro Docker, da
`S3_PUBLIC_ENDPOINT`, usato per firmare URL raggiungibili da Windows. Il profilo
predefinito pubblica backend e MinIO soltanto su `127.0.0.1`.

Per preparare credenziali casuali, avviare lo stack e collaudarlo:

```powershell
Set-Location C:\AFFETTA_GITHUB_0412
.\backend\PREPARA_E_COLLAUDA_P3_LIVE.ps1
```

Il test live verifica health/readiness, migrazione PostgreSQL, Redis, MinIO, URL
firmato, upload, checksum, persistenza metadati e cancellazione job. Non avvia
l'Agent operativo.

Con circa 4 GiB assegnati a Docker Desktop, il Compose applica limiti prudenti
ai singoli servizi. Per un deployment su due PC serve ancora TLS/HTTPS: non
esporre `AFFETTA_BIND_HOST=0.0.0.0` in una rete non fidata.

## Correzione P3.2: migrazioni nel container

Il runner delle migrazioni usa `AFFETTA_MIGRATIONS_DIR` quando definita,
altrimenti `<working-directory>/migrations`. Nel Compose locale il percorso è
esplicitamente `/app/backend/migrations`. Il collaudatore stampa inoltre i log
di `backend-migrate`, `backend` e `postgres` anche quando `docker compose up`
fallisce prima di completare.
