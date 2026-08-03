# P4.2 — Browser, job, Agent e download verificato

## Flusso utente

1. Registrazione e verifica email.
2. Accesso alla pagina `/beta/`.
3. Generazione di un codice monouso per l’Agent Windows personale.
4. Selezione o trascinamento di STL, OBJ, AMF, 3MF o STEP.
5. Calcolo SHA-256 nel browser.
6. Upload diretto tramite PUT firmato e verifica server-side.
7. Creazione idempotente di un job G-code con routing automatico.
8. Polling dello stato mentre l’Agent esegue Affetta locale.
9. Download firmato del risultato verificato entro la retention Free.

## Limiti Free applicati dal backend

```text
5 job per giorno, configurabili
50 MB per input, configurabili
24 ore di retention, configurabili
1 Agent attivo
```

Il collaudo live imposta temporaneamente la quota giornaliera a 1 per provare
il blocco del secondo job, quindi ricrea il backend con la configurazione Free
ordinaria.

## API beta P4.2

```text
GET  /v1/beta/agents
POST /v1/beta/agents/pairing-code
POST /v1/beta/agents/{id}/revoke
POST /v1/beta/artifacts/prepare-upload
POST /v1/beta/artifacts/{id}/upload-complete
GET  /v1/beta/jobs
POST /v1/beta/jobs
GET  /v1/beta/jobs/{id}
POST /v1/beta/jobs/{id}/cancel
GET  /v1/beta/jobs/{id}/download
```

## Collaudo

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File "C:\AFFETTA_GITHUB_0412\backend\p4-2\PREPARA_E_COLLAUDA_P4_2_BETA.ps1" `
  -RepoPath "C:\AFFETTA_GITHUB_0412"
```

Il test verifica account, pairing tenant, upload firmato, quote, idempotenza,
Agent reale, slicing, completamento, polling, download/checksum, riavvio senza
duplicati e revoca. Lo stack resta su loopback.

## Limiti di questa milestone

- nessun invio SMTP reale;
- nessun reset password o 2FA;
- nessuna esposizione pubblica HTTPS;
- nessun antivirus o sandbox CAD;
- nessuna stampa fisica;
- nessuna garanzia SLA.


## Compatibilità del collaudo con commit correttivi

Il launcher PowerShell non richiede più che `HEAD` coincida esattamente con il
commit iniziale P4.2. Verifica invece che la milestone
`beta: add browser job workflow and enforce free quotas` sia presente nella
cronologia recente. Questo consente di eseguire il collaudo dopo patch
correttive P4.2.x, mantenendo il blocco sui repository che non contengono P4.2.
