# P4.4.3 — Fleet Readiness

Questa fase verifica in simulazione simultanea le dodici unità seriali censite.
Avvia un Fake OctoPrint e un processo OctoBridge per ciascun nodo, usando porte,
token, directory dati e file G-code distinti.

Verifiche principali:

- 12 bridge ID, hostname e token univoci;
- rifiuto del token appartenente a un altro nodo;
- upload, SHA-256, trasferimento e avvio paralleli;
- progressi e file attivi distinti;
- isolamento tra unità dello stesso modello;
- un nodo offline senza contaminare gli altri;
- completamento autonomo con bridge spento e riconciliazione;
- annullamento e guasto attribuiti al nodo corretto;
- normalizzazione del feed Server Lite per tutti i nodi.

Esecuzione:

```powershell
.\deployment\octobridge-lab-v2leet\Invoke-AffettaFleetReadiness.ps1
```

Il PASS software non modifica mai `production_ready`, che rimane `false`.
