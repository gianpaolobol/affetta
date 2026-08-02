# P3.3.2 — Normalizzazione della coda locale

## Errore osservato

Il collaudo reale ha raggiunto:

```text
assigned/lease
downloading/download
preparing/prepare
```

Subito dopo la creazione del job locale, Affetta ha risposto
`status=queued`, `phase=queued`. L'Agent ha inoltrato `queued/queue` a
`POST /v1/jobs/{id}/progress`, ottenendo:

```text
invalid_progress_transition
```

## Decisione

La coda locale viene rappresentata nel cloud come `preparing/prepare`.
Il backend non viene ampliato per accettare una regressione a `queued`, perché
il job cloud è già stato preso in lease e assegnato a un Agent.

## Verifica anti-regressione

- test unitario diretto di `mapLocalState`;
- mock cloud che applica gli stati/stage ammessi dal backend;
- suite end-to-end Agent;
- nessuna modifica a Docker, database, storage o contratti degli artefatti.
