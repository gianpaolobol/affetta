# P3.3 — Collegamento controllato Agent → backend

## Prerequisiti

- P3.2 applicato e pubblicato;
- collaudo live P3 superato;
- stack Docker `affetta-p3` attivo;
- Affetta 0.5.2 avviabile localmente;
- almeno una unità G-code `production_ready=true`.

## Avvio

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File "C:\AFFETTA_GITHUB_0412\agent\p3-3\PREPARA_E_COLLAUDA_P3_3_AGENT.ps1" `
  -RepoPath "C:\AFFETTA_GITHUB_0412"
```

Lo script può avviare Affetta da `C:\AFFETTA` oppure dal clone Git. Non avvia
mai una stampa fisica: usa soltanto `/api/v1/slice-jobs` e verifica il G-code
caricato nello storage.

## Accettazione

Il messaggio finale deve essere:

```text
=== COLLAUDO CONTROLLATO AGENT P3.3 SUPERATO ===
```

Il report senza segreti viene scritto sotto `agent\agent-data`, cartella ignorata
da Git.


## Selezione del colore

Il job sintetico non usa un `color_id` inventato. Il collaudo legge gli ID
reali da `/api/v1/catalog`, preferisce `random`, poi `black` e `white`, e usa
infine il primo ID disponibile in ordine stabile. Se il catalogo non espone
colori, il test viene bloccato prima del pairing.

Un errore `job_failed` dell'Agent viene riportato con codice e messaggio
originali, senza essere sostituito dal generico mancato completamento.


## Normalizzazione della coda locale

La risposta iniziale di `POST /api/v1/slice-jobs` può contenere
`queued/queued`. Poiché il job cloud è già stato preso in lease, l'Agent
pubblica al backend `preparing/prepare` fino all'avvio effettivo dello slicing.

I mock end-to-end applicano lo stesso insieme di stati e stage consentiti dal
backend reale, così un ritorno futuro di `queued/queue` rende la suite rossa.


## Upload firmato e Content-Length

Il PUT del risultato usa uno stream con `Content-Length` ricavato dalla
dimensione reale del file. Questo evita HTTP 411 di MinIO senza caricare il
G-code interamente in memoria.


## Contratto del risultato finale

Prima di `/complete`, l'Agent costruisce un `affetta.result.v1` con
`request_id`, `idempotency_key` e `updated_at` derivati dalla richiesta. Il
campo legacy `completed_at` non viene emesso.
