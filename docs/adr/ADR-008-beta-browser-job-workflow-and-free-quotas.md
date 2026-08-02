# ADR-008 — Flusso browser, Agent personale e quote Free

## Stato

Accettata per P4.2.

## Contesto

P4.1 ha introdotto identità, sessioni e tenant personali. Per rendere utile la
beta serve collegare il browser al backend e all’Agent senza esporre API key,
percorsi locali o scelte di motore. Il piano Free deve inoltre applicare limiti
reali, non soltanto descriverli nell’interfaccia.

## Decisione

- il browser calcola SHA-256 del modello prima dell’upload;
- il backend prepara un PUT firmato e il browser carica direttamente su storage;
- il backend verifica nuovamente checksum e dimensione leggendo l’oggetto;
- l’utente crea un job semplificato; il backend costruisce il contratto
  `affetta.job.v1` e forza output G-code, routing automatico e
  `require_production_ready=true`;
- motore e post-processori restano nascosti nell’interfaccia base;
- ogni tenant beta genera un pairing monouso per il proprio Agent;
- il limite Free di un Agent viene verificato sia alla generazione del codice
  sia al consumo, per coprire le gare concorrenti;
- il contatore giornaliero è aggiornato nella stessa transazione PostgreSQL che
  crea il job;
- un replay con la stessa `idempotency_key` restituisce lo stesso job e non
  consuma una seconda quota;
- input, retention e numero Agent sono controllati dal backend, non dal solo
  JavaScript;
- il download è consentito soltanto per un artefatto verificato e non scaduto,
  tramite URL firmato a breve durata;
- nessuna fase invia comandi a una stampante fisica.

## Isolamento

Sessioni browser, token Agent e API key restano credenziali distinte. Job,
artefatti, Agent, utilizzo e download sono sempre filtrati per
`organization_id` del tenant personale.

## CORS locale

Il browser raggiunge MinIO su una porta diversa. Il profilo Docker locale
consente CORS soltanto dall’origine beta loopback configurata. Questa
impostazione non equivale a un deployment pubblico sicuro.

## Conseguenze

P4.2 rende disponibile un flusso completo locale browser → Agent → G-code.
Prima dell’esposizione Internet restano necessari SMTP reale, HTTPS, protezioni
abuso, scansione/sandbox dei file, policy di privacy e cancellazione, logging
operativo e hardening dello storage.
