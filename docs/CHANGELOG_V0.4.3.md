# Affetta v0.4.3

- Corretto il rilevamento di Node.js in PowerShell con `Set-StrictMode`.
- Eliminato l'accesso diretto a proprietà non garantite come `.FullName` e `.Source`.
- Aggiunto `CONTINUA_COLLAUDO_AFFETTA.cmd`, che riprende il test senza riestrarre i motori.
- `VERIFICA_MOTORI_AFFETTA.cmd` controlla ora sia i preset ufficiali sia lo slicing reale.
- I risultati vengono salvati in `data/profile-selftest.json` e `data/engine-selftest.json`.
