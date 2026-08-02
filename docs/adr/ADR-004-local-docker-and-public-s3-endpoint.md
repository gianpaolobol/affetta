# ADR-004 — Deployment Docker locale e endpoint S3 pubblico separato

- Stato: accettato
- Data: 2026-08-02
- Fase: P3.1

## Contesto

Nel Compose P3 il backend raggiunge MinIO tramite il nome DNS interno
`http://minio:9000`. Gli URL S3 firmati con lo stesso endpoint non sono però
raggiungibili da Windows o da un Agent esterno alla rete Docker. Inoltre la
password PostgreSQL dell'esempio non coincideva con quella del servizio Compose.

Il primo computer di collaudo dispone di circa 3,8 GiB assegnati a Docker
Desktop, quindi lo stack deve avere limiti prudenti.

## Decisione

1. `S3_ENDPOINT` resta l'endpoint interno usato dal backend per health e verifica.
2. `S3_PUBLIC_ENDPOINT` viene usato da un secondo client S3 esclusivamente per
   la firma degli URL di upload/download.
3. Il profilo locale pubblica backend e MinIO solo su `127.0.0.1`.
4. Docker Compose riceve credenziali coerenti tramite variabili `.env`.
5. PostgreSQL, Redis, MinIO e backend hanno limiti espliciti di memoria/CPU.
6. Uno script PowerShell genera segreti casuali ed esegue il collaudo live.

## Conseguenze

- Gli URL firmati sono utilizzabili dal processo Windows senza esporre il DNS
  interno Docker.
- Il primo collaudo resta confinato al computer locale.
- Un deployment su due computer richiederà HTTPS e un endpoint pubblico stabile;
  non è sufficiente impostare il bind su `0.0.0.0`.
- I dati Docker persistono in volumi nominati e non vengono eliminati dal test.
