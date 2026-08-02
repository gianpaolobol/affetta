# Architettura Affetta v0.5.1

```text
Web app standalone ───────────────┐
Stampa3DBologna (futuro) ─────────┼── Affetta API v1
Reborn Parts (futuro) ────────────┤        │
Service/app esterne (futuro) ─────┘        ├── autenticazione utenti e tenant
                                           ├── profili costi personali
                                           ├── cataloghi normalizzati
                                           ├── viewer STL locale
                                           ├── Estimate Router
                                           ├── Lab Fleet Router
                                           │       ├── unità fisiche e disponibilità
                                           │       ├── ruoli/materiali dedicati
                                           │       └── readiness di calibrazione
                                           └── Slice Router
                                                   ├── PrusaSlicer
                                                   ├── CuraEngine
                                                   └── OrcaSlicer / altri
```

## Principi

1. Un solo flusso utente: carica e crea il G-code.
2. Lo slicing pubblico non richiede registrazione.
3. Il prezzo viene allegato allo stesso job solo per sessioni verificate o tenant API.
4. Motori e formati interni sono nascosti dal contratto v1.
5. Stampa3DBologna e Reborn useranno chiavi server-to-server e non duplicheranno il core.
6. Il viewer è distribuito localmente dal server Node.js e non richiede CDN.
7. La quantità genera una disposizione multipla sul singolo piano; il job viene rifiutato se le copie non entrano.

## Separazione dei moduli

- `server.js`: routing HTTP, sessioni, CORS e risposte.
- `src/auth-*`: registrazione, verifica email, login e persistenza.
- `src/user-pricing.js`: validazione e formula personale.
- `src/quote-service.js`: stima e creazione preventivo.
- `src/slice-service.js`: job, disposizione copie, provider e validazione G-code.
- `src/providers/`: adattatori dei motori.
- `public/`: SPA e viewer.
- `integration/`: client PHP/JS per le integrazioni.

## Router del parco macchine

`config/fleet.json` descrive le unità fisiche. `src/fleet-router.js` seleziona soltanto unità abilitate e fisicamente validate, controllando tecnologia, materiale assegnato, qualità, resistenza, quantità, ingombro, altezza e ruolo produttivo. Il modello stampante resta separato dall’unità per consentire ugelli e dedicazioni differenti su macchine uguali.
