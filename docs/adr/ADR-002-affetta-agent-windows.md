# ADR-002 — Affetta Agent Windows outbound-only

- **Stato:** accepted
- **Data:** 2026-08-02
- **Decisione:** introdurre un processo TypeScript separato sotto `agent/`, responsabile dell'orchestrazione cloud ↔ Affetta locale.

## Contesto

Affetta 0.5.2 espone già API locali per health, capability, creazione e polling dei job, oltre al download dell'artefatto. Il backend online non deve accedere direttamente alla porta locale né includere i motori di slicing. Serve un componente residente sul computer Windows del laboratorio che lavori soltanto in uscita e mantenga uno stato recuperabile.

## Decisione

L'Agent:

1. usa il contratto `affetta.job.v1` come input e `affetta.result.v1` come output;
2. effettua pairing con codice monouso e conserva il token cifrato;
3. invia heartbeat con capability normalizzate;
4. acquisisce un solo lease per volta nella prima versione;
5. verifica SHA-256 e byte count prima di inviare il file ad Affetta locale;
6. chiama esclusivamente un URL loopback per Affetta;
7. persiste job, eventi, transfer e lease in SQLite;
8. riusa `local_job_id`, file verificati e upload completati dopo un riavvio;
9. usa URL firmati HTTPS per storage; gli host sono allowlistati;
10. non esegue comandi shell e non espone una porta in ascolto;
11. usa un lock PID per impedire processi concorrenti;
12. verifica unità, profilo, materiale e `production_ready` prima del routing manuale.

Il driver SQLite è astratto. Il packaging Windows preferisce `better-sqlite3` 13 N-API; `node:sqlite` è ammesso come fallback per test e diagnostica, non come dipendenza invisibile da assumere senza collaudo.

## Adattamento Affetta 0.5.2

Il payload normalizzato viene trasformato nell'API locale esistente:

- `routing.mode=automatic` → `printer_id=auto-lab`;
- routing manuale → `printer_profile_id` usato come `printer_id`;
- modello trasferito tramite `file_base64`;
- `fleet_unit_id` manuale senza profilo produce errore strutturato, perché l'API 0.5.2 non dispone ancora di un endpoint dedicato;
- il risultato locale viene completato con versione e hash deterministico del profilo applicato.

## Conseguenze

### Positive

- nessuna porta del laboratorio esposta su Internet;
- separazione netta tra cloud, orchestrazione e slicing;
- recovery testabile e idempotenza end-to-end;
- nessun runtime slicer nel repository;
- supporto sia G-code sia X3G.

### Debito esplicito

- aggiungere un endpoint locale streaming per evitare Base64 sui modelli grandi;
- definire revoca e rotazione token nel backend P3;
- produrre servizio Windows ed eseguibile firmato;
- qualificare il driver SQLite e il processo di migrazione;
- introdurre multipart upload e retention/cleanup configurabile.
