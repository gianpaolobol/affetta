# ADR-006 — Primo pairing Agent controllato e locale

## Stato

Accettato per P3.3.

## Decisione

Il primo collegamento Agent viene collaudato esclusivamente su loopback:

- backend `http://127.0.0.1:8790`;
- Affetta locale `http://127.0.0.1:8787`;
- storage MinIO `http://127.0.0.1:9000`.

Il collaudo crea un codice di pairing monouso e un Agent temporaneo. L'Agent:

1. pubblica heartbeat e capability;
2. acquisisce un job STL sintetico;
3. usa una unità G-code `production_ready=true`;
4. invoca soltanto l'API di slicing locale;
5. carica il G-code su MinIO;
6. completa il job con checksum verificato;
7. viene riavviato senza duplicare il job;
8. viene revocato dal backend e rifiutato al successivo heartbeat.

La Thing-O-Matic è esclusa dal target del collaudo perché resta sperimentale,
`production_ready=false` e con validazione fisica pendente.

## Sicurezza

- nessun token o pairing code entra nel report;
- il pairing code passa soltanto nell'ambiente del primo processo Agent;
- i dati temporanei Agent vengono eliminati dopo il successo;
- backend, storage e Affetta restano non esposti in LAN;
- nessun comando viene inviato a una stampante fisica.


## Compatibilità con il catalogo locale

I valori di `print_intent` che Affetta valida come enumerazioni devono essere
derivati dal catalogo locale. In particolare `color_id` viene selezionato dagli
ID pubblicati da `/api/v1/catalog`; P3.3 non mantiene un valore colore fisso.


## Stato della coda locale

Dopo il lease cloud, Affetta locale può restituire temporaneamente
`status=queued` e `phase=queued`. Questo stato descrive soltanto la coda
interna del runtime Windows e non rappresenta una regressione del job cloud.

L'Agent normalizza pertanto:

```text
local queued/queued -> cloud preparing/prepare
```

Il backend continua a rifiutare `queued/queue` sugli endpoint di avanzamento
di un job già assegnato. Questa separazione preserva una macchina a stati cloud
monotona e impedisce che dettagli interni del runtime locale modifichino il
contratto distribuito.


## Upload di artefatti firmati

Gli upload PUT firmati dichiarano la lunghezza esatta del corpo. L'Agent ricava
`Content-Length` dal file locale, verifica valori già presenti negli header e
mantiene lo streaming.
