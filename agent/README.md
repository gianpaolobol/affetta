# Affetta Agent Windows 0.1.0

Skeleton P2 dell'orchestratore locale. L'Agent non contiene uno slicer: acquisisce un lease dal backend, scarica e verifica il modello, invia il lavoro ad Affetta standalone su `127.0.0.1`, recupera l'artefatto, lo carica sullo storage firmato e completa il job cloud.

## Proprietà della prima versione

- solo connessioni HTTPS in uscita verso cloud e storage;
- Affetta locale accettato esclusivamente su loopback;
- persistenza SQLite con tabelle `agent`, `jobs`, `job_events`, `downloads`, `uploads`, `leases`, `settings`;
- pairing, heartbeat, lease, ACK, progress, complete e fail;
- verifica SHA-256 e dimensione sia in download sia in upload;
- ripresa dopo riavvio senza ricreare il job locale già registrato;
- lock PID per impedire due Agent concorrenti sulla stessa installazione;
- guardia su unità/profilo/materiale e `production_ready` prima del routing manuale;
- token cifrato AES-256-GCM, con chiave separata e ACL applicate dallo script Windows;
- log JSON strutturati senza token;
- mock backend e mock Affetta per test end-to-end.

## Runtime

Per la beta Windows usare Node.js 24 LTS. Il driver preferito è `better-sqlite3` N-API. Se il modulo non è disponibile, lo skeleton può usare `node:sqlite` come fallback diagnostico; il packaging definitivo dovrà includere e collaudare il driver scelto.

## Avvio di sviluppo

```powershell
Set-Location agent
Copy-Item .env.example .env
npm install --no-package-lock
npm run build
npm test
npm start
```

Lo script `INSTALLA_AGENT.cmd` automatizza i controlli principali su Windows. Il pairing code è monouso e non viene salvato.

## Limiti intenzionali del P2

- un job attivo per Agent;
- upload/download mediante URL firmati HTTP(S), non ancora multipart;
- adattamento all'API locale 0.5.2 tramite payload Base64;
- servizio Windows ed eseguibile singolo rinviati alla fase packaging;
- revoca gestita dal backend tramite risposta `401/403`; UI di revoca rinviata al backend P3.

Il lockfile delle dipendenze non è incluso nel P2 perché l’ambiente di consegna non ha potuto risolvere il registry npm completo. Prima della beta distribuibile va generato e versionato da un ambiente con registry ufficiale/aziendale funzionante.
