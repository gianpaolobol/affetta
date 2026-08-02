# Affetta Job Contract v1

## Scopo

Il contratto `v1` separa interfacce, siti, motori, stampanti, sistemi operativi, provider AI e laboratori. Tutti i payload pubblici sono JSON e non contengono percorsi locali, comandi CLI, token o URL di storage permanenti.

Schemi:

- `schemas/job-request-v1.schema.json` — richiesta normalizzata;
- `schemas/job-result-v1.schema.json` — stato e risultato del job;
- `schemas/job-event-v1.schema.json` — evento append-only;
- `schemas/agent-capabilities-v1.schema.json` — capability dichiarate dall’Agent;
- `schemas/error-v1.schema.json` — errore strutturato;
- `schemas/common-v1.schema.json` — enum e definizioni condivise.

## Versioning

Ogni documento dichiara una versione immutabile:

```text
affetta.job.v1
affetta.result.v1
affetta.event.v1
affetta.agent-capabilities.v1
```

Regole:

1. una modifica incompatibile crea `v2` e nuovi file schema;
2. in `v1` non si aggiungono campi obbligatori né nuovi valori agli enum senza una revisione compatibile dei consumer;
3. estensioni sperimentali devono stare in `extensions`, con chiavi reverse-DNS, per esempio `it.stampa3dbologna.order`;
4. producer e consumer mantengono fixture canoniche `v1` nei test;
5. il backend rifiuta versioni sconosciute con `unsupported_schema_version`.

## Idempotenza

`idempotency_key` è generata dal client e identifica semanticamente una richiesta. Per la stessa coppia `tenant/source + idempotency_key`:

- payload identico: il backend restituisce lo stesso `job_id` e non crea un duplicato;
- payload differente: il backend risponde con conflitto e non modifica il job esistente;
- retry di rete: il client riutilizza la stessa chiave;
- una nuova intenzione di stampa usa una nuova chiave.

Il backend conserva l’hash canonico della richiesta normalizzata insieme alla chiave.

## Identificativi e artefatti

Gli identificativi pubblici sono opachi (`req_…`, `job_…`, `art_…`, `agt_…`). I binari sono conservati fuori dal database; il contratto trasporta solo metadati e SHA-256.

Ogni artefatto richiede:

- `artifact_id`;
- `type` e `format`;
- `sha256` esadecimale minuscolo di 64 caratteri;
- `size_bytes`.

Download e upload useranno URL firmati a scadenza, definiti dall’API e non persistiti nel job contract.

## Unità

Le unità sono esplicite nei nomi:

- `size_bytes`;
- `time_seconds`;
- `millimeters` e campi con suffisso `_mm`;
- `grams`;
- `disk_free_bytes`.

La geometria di input usa millimetri; `input.units` può essere soltanto `millimeter` in `v1`.

## Stati

Macchina a stati canonica:

```text
created → uploaded → queued → leased → assigned → downloading
→ preparing → slicing → validating → postprocessing → uploading
→ completed
```

Rami controllati:

```text
retrying → queued
manual_review → queued | failed | cancelled
cancel_requested → cancelled
qualsiasi stato operativo → failed | expired
```

Ogni transizione produce un `job-event`. Gli eventi sono append-only e ordinati da `sequence`; il risultato rappresenta lo snapshot corrente.

## Routing e produzione

`routing.require_production_ready=true` è obbligatorio per flussi commerciali. Un profilo o una unità con `production_ready=false` non può essere assegnato a quel job.

La richiesta X3G di esempio usa `require_production_ready=false` perché è un collaudo software Thing-O-Matic. Il risultato resta `experimental` e contiene l’avviso di collaudo fisico pendente.

## Errori

La UI legge `code`, `stage` e `retryable`; non deve interpretare stringhe di log. `message` è una descrizione localizzabile per l’utente, mentre `details` e `observed` contengono dati strutturati sicuri.

Esempio: `docs/contracts/examples/error.json`.

## Capability Agent

L’Agent pubblica solo capability, versioni e stati. Non pubblica percorsi dei binari. Il campo `capability_sha256` permette al backend di rilevare cambiamenti e invalidare assegnazioni incompatibili.

Le capability separano:

- motori di slicing;
- post-processori;
- formati di output;
- profili e loro hash/versione;
- `profile_status`;
- `production_ready`;
- `physical_validation`.

## Esempi canonici

- G-code produttivo: `job-request-gcode.json` e `job-result-gcode.json`;
- X3G sperimentale: `job-request-x3g.json` e `job-result-x3g.json`;
- evento, errore e capability Agent nella stessa cartella.

## Sicurezza

- nessun path locale nei payload;
- filename senza slash, backslash o caratteri di controllo;
- limiti dimensionali nello schema e limiti più restrittivi a livello tenant;
- hash verificato dopo ogni download/upload;
- `additionalProperties=false` nei nuclei contrattuali per intercettare typo;
- estensioni isolate nel campo `extensions`;
- log e diagnostica non devono includere segreti.
## Identificatori delle unità fisiche

`fleet_unit_id` usa lo stesso slug pubblico del catalogo locale, ad esempio
`x1c-01` o `thing-o-matic-01`. Non usa il formato degli ID database con
prefisso e underscore. La regola vale in richieste, capability Agent e risultati.
