# Avvio Windows

Affetta v0.4.2 non usa `npm start` nel launcher Windows.

`AVVIA_AFFETTA.cmd` richiama `scripts/start-windows.ps1`, che:

1. individua Node.js installato oppure il runtime portatile;
2. crea la configurazione al primo avvio;
3. avvia `bootstrap.js`;
4. controlla `/api/v1/health`;
5. apre il browser soltanto quando il servizio risponde.

In caso di errore esegui `DIAGNOSTICA_AFFETTA.cmd` e consulta:

- `data/startup.log`;
- `data/server.stdout.log`;
- `data/server.stderr.log`.
