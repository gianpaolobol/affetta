# Integrazione con Affetta Server Lite

## Registrazione adattatore

L'applicatore aggiunge `OctoBridgeAdapter` al registry con chiave:

```text
octobridge
```

Esempio stampante in `server-lite/config/local-server.json`:

```json
{
  "id": "predator-octobridge-zero-01",
  "name": "Anycubic Predator — OctoBridge Zero 01",
  "model": "Anycubic Predator",
  "adapter": "octobridge",
  "enabled": false,
  "endpoint": "http://192.168.1.80:8792",
  "api_key": "env:AFFETTA_OCTOBRIDGE_PREDATOR_TOKEN"
}
```

Lasciare `enabled: false` finché non sono stati verificati IP, token, camera, seriale e alimentazione.

## Metodi dell'adattatore

- `probe(printer)`: stato normalizzato per la dashboard P4.3;
- `stageJob(printer, job)`: crea il job, invia byte originali, richiede la verifica OctoPrint;
- `startJob(printer, jobId)`: avvio separato e consentito solo dopo `transferred`;
- `cancelJob(printer, jobId)`;
- `pendingSync(printer)`;
- `acknowledgeSync(printer, jobId, ack)`.

`stageJob` calcola nuovamente dimensione e SHA-256 dal file presente sul Server Lite. Non modifica il contenuto e invia il file come stream.

## Contratto minimo del job

```js
{
  id: "job-2026-0001",
  filename: "pezzo.gcode",
  gcode_path: "C:\\...\\pezzo.gcode",
  printer_profile_id: "anycubic-predator",
  sha256: "...",       // opzionale: se presente viene verificato
  size_bytes: 123456,  // opzionale: se presente viene verificato
  display_name: "Pezzo prova",
  source: {}
}
```

## Riconciliazione

Il `probe` non converte un valore mancante in zero. Percentuale, tempi e file restano `null` quando il bridge non li possiede. `cancel_requested` viene mantenuto nel campo raw e normalizzato temporaneamente come stampa in corso, non come annullamento già completato.

## Passaggio successivo

La P4.4 introduce il trasporto e il relativo adattatore, ma non collega ancora automaticamente il pulsante di stampa della UI principale a `stageJob/startJob`. Tale collegamento deve avvenire dopo il primo collaudo Pi Zero e dopo la definizione definitiva del flusso di conferma utente.
