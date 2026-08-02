# ADR-007 — Identità beta web e fondazione piano Free

## Stato

Accettata per P4.1.

## Contesto

Dopo il collaudo P3, Affetta possiede contratti, backend, coda e Agent locale.
La roadmap richiede ora una beta web gratuita per maker, principianti, piccoli
service, scuole e laboratori. L'account browser non deve riutilizzare API key o
token Agent.

## Decisione

- ogni utente beta riceve una organizzazione personale e una membership owner;
- email e username sono normalizzati e unici;
- il cellulare è salvato in formato E.164;
- le password sono derivate con scrypt e salt casuale;
- i token email e sessione sono conservati solo come SHA-256;
- l'email deve essere verificata prima del login;
- la sessione usa un bearer opaco separato dal bearer Agent;
- il profilo costi è privato e usa unità esplicite in euro;
- i limiti Free sono configurabili e pubblicati dall'API;
- la modalità base non mostra il motore di slicing;
- l'outbox email è persistita, ma il worker SMTP e il flusso upload/job sono P4.2.

## Sicurezza

`AFFETTA_BETA_EXPOSE_DEV_TOKENS=true` è ammesso soltanto nel Compose locale
vincolato a `127.0.0.1`. In qualsiasi ambiente raggiungibile da Internet deve
essere `false` e il token deve essere consegnato dal worker email.

## Conseguenze

P4.1 rende testabile registrazione, verifica, login, profilo e logout. Non
rappresenta ancora la beta pubblica completa: upload, quota effettiva dei job,
retention e download saranno collegati in P4.2.
