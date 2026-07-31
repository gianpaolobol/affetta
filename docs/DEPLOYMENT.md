# Pubblicazione

## Locale

```bash
npm run init
npm start
```

## Docker

```bash
npm run init
docker compose up --build
```

## Server pubblico

1. impostare `AFFETTA_PUBLIC_BASE_URL` con HTTPS;
2. configurare `AFFETTA_ALLOWED_ORIGINS`;
3. usare chiavi API diverse per ogni integrazione;
4. montare `data/` su disco persistente;
5. installare i motori in processi separati o nella stessa macchina;
6. disattivare il fallback geometrico se il preventivo commerciale deve dipendere obbligatoriamente da Kiri:Moto;
7. non attivare `AFFETTA_ALLOW_DEMO_GCODE` in produzione.

Configurazione prudenziale:

```env
AFFETTA_PUBLIC_MODE=true
AFFETTA_REQUIRE_KIRI=true
AFFETTA_ALLOW_GEOMETRY_FALLBACK=false
AFFETTA_ALLOW_DEMO_GCODE=false
AFFETTA_EXPOSE_ENGINE_NAMES=false
```

## Reverse proxy

Usare Nginx, Caddy o equivalente con:

- HTTPS;
- limite upload coerente con `AFFETTA_MAX_FILE_MB`;
- timeout superiore al tempo massimo di upload;
- rate limit aggiuntivo;
- log senza contenuti Base64.
