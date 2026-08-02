# P4.1 — Fondazione beta web gratuita

## Incluso

- pagina `/beta/` responsive;
- registrazione con email, username, cellulare, password e termini;
- verifica email tramite outbox;
- login e logout;
- sessioni revocabili e a scadenza;
- spazio personale per organizzazione;
- profilo costi in EUR;
- limiti Free pubblicati da `/v1/beta/limits`;
- migrazione PostgreSQL `002_beta_web_accounts.sql`;
- test memoria e collaudo live Docker.

## Non incluso

- invio SMTP reale;
- recupero password e 2FA;
- upload del modello dal browser;
- creazione/polling/download del job autenticato;
- enforcement delle quote Free;
- antivirus e sandbox CAD;
- esposizione HTTPS pubblica.

Questi elementi appartengono a P4.2 e agli hardening successivi.

## Endpoint

```text
GET   /beta/
GET   /v1/beta/limits
POST  /v1/beta/register
POST  /v1/beta/verify-email
POST  /v1/beta/login
GET   /v1/beta/me
PATCH /v1/beta/me/cost-profile
POST  /v1/beta/logout
```
