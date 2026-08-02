# ADR-003 — Backend, coda autorevole e storage artefatti

- Stato: accepted
- Data: 2026-08-02
- Ambito: P3 backend online e coda

## Contesto

L'Agent P2 deve ottenere job senza esporre Affetta locale. Il sistema deve impedire doppie esecuzioni, supportare retry, revoca, idempotenza, tenant isolation e artefatti verificati.

## Decisione

1. PostgreSQL è la fonte autorevole dello stato job e del lease.
2. Redis contiene la ready queue e accelera la ricerca dei candidati.
3. La presa in carico è valida soltanto dopo un compare-and-set atomico sul record PostgreSQL.
4. Gli artefatti risiedono in storage S3 compatibile; il database conserva soltanto metadati.
5. Gli URL di upload/download sono firmati e a scadenza breve.
6. Dopo l'upload, il backend rilegge l'oggetto entro un limite configurabile e verifica SHA-256 e dimensione.
7. Gli errori retryable applicano backoff esponenziale; superato `max_attempts`, il job entra in stato finale `failed` o `expired` con `dead_letter_at`.
8. Il backend resta separato da Affetta locale e non contiene slicer.

## Motivazioni

- PostgreSQL consente aggiornamenti condizionali e transazioni per lease e idempotenza.
- Redis riduce la scansione dei job pronti senza diventare una seconda fonte di verità.
- S3 separa i binari dai metadati e permette URL firmati.
- Il checksum post-upload evita di fidarsi soltanto dei metadati inviati dal client.

## Conseguenze

- Il sistema continua a funzionare correttamente anche se Redis perde una notifica: il database resta autorevole, ma serve un processo periodico di riconciliazione nella fase successiva.
- La verifica streaming ha costo I/O e deve essere sostituita o affiancata da checksum nativi S3 per file molto grandi.
- Il backend richiede migrazioni e gestione segreti prima del deploy.

## Fonti tecniche primarie

- Fastify/Node non sono vincolanti: P3 usa il server HTTP di Node per ridurre dipendenze nel core.
- node-postgres transactions: https://node-postgres.com/features/transactions
- Redis transactions e Node client: https://redis.io/docs/latest/develop/using-commands/transactions/ e https://redis.io/docs/latest/develop/clients/nodejs/
- AWS SDK v3 presigned URL: https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/migrate-s3.html
