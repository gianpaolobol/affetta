# P3.3.4 — Allineamento del risultato ad affetta.result.v1

## Problema osservato

Dopo l'upload verificato del G-code, il backend rifiutava `/complete` con
`invalid_job_result`.

L'Agent emetteva `completed_at`, che non è previsto dallo schema, e ometteva i
campi obbligatori `request_id`, `idempotency_key` e `updated_at`.

## Decisione

Il risultato completato riporta:

- `job_id` dal job cloud;
- `request_id` dalla richiesta normalizzata;
- `idempotency_key` dalla richiesta normalizzata;
- `status: completed`;
- `updated_at` con timestamp ISO corrente.

`completed_at` non viene più emesso, perché `additionalProperties: false` lo
rende incompatibile con `affetta.result.v1`.

## Verifica

Il mock cloud valida il payload effettivamente prodotto dall'Agent e il backend
esegue due test Ajv: accettazione della forma corrente e rifiuto della forma
legacy.
