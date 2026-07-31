# Architettura Affetta v0.4.2

```text
Web app standalone ───────────────┐
Stampa3DBologna (futuro) ─────────┼── Affetta API v1
Reborn Parts (futuro) ────────────┤        │
Service/app esterne (futuro) ─────┘        ├── autenticazione utenti e tenant
                                           ├── profili costi personali
                                           ├── cataloghi normalizzati
                                           ├── viewer STL locale
                                           ├── Estimate Router
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
