# Affetta Backend V0 — P3

## Responsabilità

- autenticazione API key e Agent;
- pairing, heartbeat e revoca;
- job idempotenti;
- ready queue, lease e rinnovo;
- retry, backoff e dead letter;
- cancellazione;
- metadati e verifica artefatti;
- eventi append-only;
- health, readiness, OpenAPI e metriche.

## Flusso Agent

```text
pair → heartbeat → lease → ack → progress* → upload-complete → complete/fail
```

## Autorità dello stato

PostgreSQL è autorevole. Redis propone candidati pronti, ma un job è assegnato solo dopo `claimJob` atomico. S3 conserva i file; il database conserva `storage_key`, hash, dimensione, stato e retention.

## Recovery

- lease scaduto + tentativi disponibili → `retrying`;
- lease scaduto + tentativi esauriti → `expired` e dead letter;
- errore retryable → backoff esponenziale;
- errore non retryable → `failed`;
- cancellazione senza lease → `cancelled`;
- cancellazione durante lease → `cancel_requested`, poi `cancelled` al fail/scadenza.

## Test P3

Gli otto test isolati verificano:

1. compatibilità endpoint con Agent P2;
2. idempotenza;
3. esclusione doppio lease;
4. retry/dead letter;
5. cancellazione;
6. checksum;
7. filtro `production_ready`;
8. revoca Agent.

I test live PostgreSQL/Redis/S3 via Docker sono il prossimo livello di accettazione sul PC del laboratorio o in CI.
