# ADR-001 — Contratto normalizzato per job e Agent

- **Stato:** accettato
- **Data:** 2026-08-02
- **Decisione:** introdurre un contratto JSON Schema 2020-12 versionato prima di sviluppare Agent e backend.

## Contesto

Affetta deve ricevere job da interfaccia standalone, beta web, Stampa3DBologna, Reborn e partner. I job possono essere eseguiti da motori differenti e produrre G-code, X3G o altri artefatti. Senza un contratto comune, UI, backend, Agent e adattatori finirebbero per scambiarsi path locali e stringhe specifiche del motore.

## Decisione

1. Usare JSON Schema Draft 2020-12 con `$id` stabili sotto `https://schemas.affetta.dev/`.
2. Separare request, result, event, error e capability Agent.
3. Centralizzare enum e tipi comuni in `common-v1.schema.json`.
4. Rendere obbligatori SHA-256, dimensioni e identificativi opachi degli artefatti.
5. Vietare path locali e proprietà non dichiarate nei nuclei del contratto.
6. Riservare `extensions` a estensioni namespaced e non critiche.
7. Definire idempotenza su `source/tenant + idempotency_key + hash canonico`.
8. Separare motore, post-processore, profilo, unità fisica, stato profilo, produzione e collaudo fisico.
9. Modellare gli eventi come append-only e il risultato come snapshot.
10. Mantenere esempi canonici G-code e X3G come fixture di compatibilità.

## Alternative scartate

- **Payload specifici per sito:** duplicano logica e rendono fragile l’integrazione.
- **Path condivisi tra cloud e Agent:** non portabili e insicuri.
- **Un solo schema monolitico:** accoppia eccessivamente eventi, capability e risultati.
- **Errori come testo libero:** obbligano la UI a fare parsing dei log.
- **Protobuf immediato:** introduce toolchain non necessaria nella fase iniziale; JSON resta più semplice per PHP legacy e browser.

## Conseguenze

### Positive

- Agent e backend possono essere sviluppati contro fixture stabili;
- PHP, Node e browser condividono lo stesso linguaggio contrattuale;
- idempotenza, hash e stati diventano verificabili;
- X3G e G-code sono rappresentati senza esporre Cura o GPX all’utente base.

### Costi e rischi

- ogni modifica incompatibile richiede una nuova major del contratto;
- enum troppo rigidi richiedono disciplina di release;
- tutti i consumer devono validare i payload ai confini;
- le estensioni non devono diventare un canale per aggirare il contratto.

## Verifica

`test/contracts/job-contract.test.js` compila gli schemi con Ajv 2020, valida le fixture canoniche e rifiuta casi invalidi, inclusi hash errati, quantità zero, path locali, stati incoerenti e risultati X3G senza GPX.
