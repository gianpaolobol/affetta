# API Affetta OctoBridge v1

Tutti gli endpoint, eccetto `GET /health`, richiedono:

```http
Authorization: Bearer <api_token>
```

## Stato

- `GET /health`
- `GET /v1/status`
- `GET /v1/printers`

## Store-and-forward

1. `POST /v1/jobs` con `job_id`, `filename`, `size_bytes`, `sha256`, `printer_profile_id`.
2. `PUT /v1/jobs/{job_id}/gcode` con `Content-Length` esatto e byte del file.
3. `POST /v1/jobs/{job_id}/transfer` per upload e verifica della copia OctoPrint.
4. `POST /v1/jobs/{job_id}/start` per snapshot pre-print e avvio.

Il passaggio 4 viene rifiutato se il job non è `transferred`.

## Controlli

- `POST /v1/jobs/{job_id}/pause`
- `POST /v1/jobs/{job_id}/resume`
- `POST /v1/jobs/{job_id}/cancel`

## Sincronizzazione

- `GET /v1/sync/pending`
- `GET /v1/jobs/{job_id}`
- `GET /v1/jobs/{job_id}/events?after=N`
- `GET /v1/jobs/{job_id}/files/{filename}`
- `POST /v1/jobs/{job_id}/sync-ack`

Esempio ack:

```json
{
  "event_sequence": 18,
  "files": ["00_pre_print.jpg", "01_progress_25.jpg"]
}
```

## Live

- `POST /v1/live/start` con `{"duration_seconds":45}`;
- `GET /v1/live/status`;
- `GET /v1/live/frame.jpg`;
- `POST /v1/live/stop`.

Il client può aggiornare `frame.jpg` a 1–2 richieste al secondo. Il bridge non espone un live permanente.
