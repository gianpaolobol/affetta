# ADR-005 — Percorso migrazioni nel runtime container

## Stato
Accettato.

## Contesto
Il Dockerfile copia le migrazioni SQL in `/app/backend/migrations`, mentre il
modulo compilato è eseguito da `/app/backend/dist/src/migrate.js`. Risolvere il
percorso relativamente al file JavaScript portava quindi a
`/app/backend/dist/migrations`, directory inesistente nel container.

## Decisione
Il backend risolve le migrazioni da `AFFETTA_MIGRATIONS_DIR`, quando impostata,
altrimenti da `<process.cwd()>/migrations`. Il container usa `/app/backend` come
working directory, quindi il percorso coincide con quello copiato dal
Dockerfile. Lo stesso comportamento vale nello sviluppo locale dalla cartella
`backend`.

## Conseguenze
- migrazioni eseguibili sia localmente sia nel container;
- percorso esplicitamente sovrascrivibile;
- test unitari sul resolver;
- il collaudatore live stampa automaticamente stato e log Compose in caso di
  errore.
