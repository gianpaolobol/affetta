# Architettura bidirezionale Affetta ↔ OctoBridge

## Identità

Ogni macchina dispone di quattro identificativi distinti:

- `fleet_unit_id`: unità fisica in `config/fleet.json`;
- `printer_profile_id`: modello/profilo di slicing;
- `bridge_id`: controller Raspberry univoco;
- `hostname`: nome riconoscibile nella LAN.

Esempio:

```json
{
  "fleet_unit_id": "predator-01",
  "printer_profile_id": "anycubic-predator",
  "bridge_id": "octobridge-predator-01",
  "hostname": "affetta-predator-01"
}
```

## Direzione Affetta → bridge

L’adapter `octobridge` di Server Lite può:

- creare il job;
- inviare l’intero G-code;
- chiedere il trasferimento a OctoPrint;
- avviare;
- annullare;
- leggere e riconoscere errori HTTP.

Il bridge verifica dimensione e SHA-256 prima di consentire l’avvio.

## Direzione bridge → Affetta

Server Lite legge:

- `/v1/status`;
- `/v1/sync/pending`;
- job ed eventi;
- snapshot registrati;
- bridge ID e profilo;
- stato della connessione;
- stato macchina;
- stato lavoro;
- percentuale e tempi;
- file attivo;
- temperature ed errori.

Il modello è deliberatamente **pull-based** dal lato Affetta: se Server Lite è
spento, OctoBridge e OctoPrint continuano il lavoro. Alla riaccensione il server
interroga nuovamente ogni hostname e riconcilia lo stato.

## Garanzie mantenute

- upload non equivale ad avvio;
- stato memorizzato non equivale a stato reale;
- il server può essere spento dopo l’avvio verificato;
- il Raspberry deve restare acceso durante la stampa seriale;
- eventi e file restano localmente finché Affetta non li riconcilia;
- esito non determinabile resta `outcome_unknown`.
