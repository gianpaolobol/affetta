# Affetta API v1

Specifica completa disponibile durante l’esecuzione:

```text
GET /api/v1/openapi.json
```

## Flusso unificato

```http
POST /api/v1/affetta-jobs
Content-Type: application/json
```

Esempio:

```json
{
  "filename": "pezzo.stl",
  "file_base64": "...",
  "printer_id": "generic-reprap-marlin",
  "nozzle_mm": 0.4,
  "material_id": "pla",
  "quality_id": "standard",
  "strength_id": "standard",
  "color_id": "custom",
  "custom_color": "Blu petrolio",
  "quantity": 2,
  "source": "partner-site",
  "external_ref": "ORDER-123"
}
```

- richiesta pubblica same-origin: restituisce il job senza prezzo;
- sessione web verificata: restituisce job e prezzo personale;
- Bearer API partner: restituisce job e prezzo del tenant.

## Account

- `POST /api/v1/auth/register`
- `GET /api/v1/auth/verify?token=...`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`
- `GET /api/v1/user/pricing-profile`
- `PUT /api/v1/user/pricing-profile`

## Compatibilità

Restano disponibili:

- `POST /api/v1/slice-jobs`
- `GET /api/v1/slice-jobs/{id}` — HTTP 200 per job attivo/completato; HTTP 422 JSON per job fallito
- `GET /api/v1/slice-jobs/{id}/artifact?token=...`
- `POST /api/v1/quotes`
- `GET /api/v1/quotes/{id}`
