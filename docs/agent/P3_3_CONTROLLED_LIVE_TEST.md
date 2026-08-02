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
