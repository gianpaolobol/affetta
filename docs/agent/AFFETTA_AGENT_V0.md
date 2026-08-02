# Affetta Agent Windows — protocollo operativo P2

## Flusso

```text
pairing
→ heartbeat capability
→ lease
→ ACK
→ download firmato
→ SHA-256 + byte count
→ POST Affetta locale
→ polling locale
→ download artefatto
→ upload firmato
→ upload-complete
→ complete / fail
```

## Endpoint cloud usati

```text
POST /v1/agents/pair
POST /v1/agents/{id}/heartbeat
POST /v1/agents/{id}/lease
POST /v1/jobs/{id}/ack
POST /v1/jobs/{id}/progress
POST /v1/jobs/{id}/complete
POST /v1/jobs/{id}/fail
POST /v1/artifacts/{id}/upload-complete
```

Il rinnovo del lease avviene attraverso `progress`: il backend può restituire un nuovo `lease_expires_at`. `complete`, `fail`, `ack` e `upload-complete` devono essere idempotenti rispetto a `job_id`, `lease_id` e `artifact_id`.

## Recovery

L'Agent salva prima di ogni side effect:

- lease completo;
- `local_job_id` appena Affetta lo restituisce;
- path e hash verificati;
- ricevuta upload;
- risultato normalizzato.

Dopo un riavvio:

- non riscarica un input già verificato;
- non ricrea un job Affetta se esiste `local_job_id`;
- non ricarica un artefatto con ricevuta registrata;
- può ripetere `complete` senza duplicare il lavoro.

## Sicurezza

- cloud e storage solo HTTPS, salvo opt-in esplicito per mock localhost;
- storage host allowlist;
- Affetta locale solo `localhost`, `127.0.0.1` o `::1`;
- token cifrato AES-256-GCM;
- chiave e data directory protette con ACL Windows;
- niente path locali nei contratti pubblici;
- niente token nei log JSON;
- limiti di dimensione e timeout.

## Stati locali

Gli stati persistiti riusano gli enum del contratto. Gli stati Affetta 0.5.2 vengono tradotti in `preparing`, `slicing`, `validating` e `postprocessing`. Un errore retryable entra in `retrying`: se il lease è ancora valido il riavvio riprende lo stesso tentativo, altrimenti il job attende un nuovo lease; un errore definitivo entra in `failed`.

## Compatibilità adapter 0.5.2

L’adapter Base64 rifiuta esplicitamente formati diversi da STL e quantità superiori a 999, perché l’API locale 0.5.2 non li supporta senza conversione o streaming. Il limite predefinito del download è quindi 25 MB, coerente con Affetta 0.5.2. Il routing manuale verifica corrispondenza unità/profilo/materiale e applica `require_production_ready` prima dello slicing.
