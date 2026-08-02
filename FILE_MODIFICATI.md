# File modificati — Affetta 0.5.1

## Configurazione

- `config/printers.json`
- `config/fleet.json`
- `config/internal-profiles.json` — nuovo
- `config/app.json`
- `config/profiles/cura/lulzbot-taz4.def.json` — nuovo
- `config/profiles/cura/lulzbot-taz5.def.json` — nuovo
- `config/profiles/cura/lulzbot-mini.def.json` — nuovo

## Backend

- `server.js`
- `src/config.js`
- `src/slice-service.js`
- `src/openapi.js`
- `src/providers/kiri-estimate.js`

## Interfaccia

- `public/app.js`
- `public/viewer.js`
- `public/index.html`

## Test

- `test/lab-fleet.test.js`
- `test/engine-routing.test.js`
- `test/ui-api.test.js`
- `test/viewer-bed.test.js` — nuovo
- `test/windows-updater.test.js`

## Installazione e versione

- `VERSION`
- `package.json`
- `APPLICA_AFFETTA_0501.cmd` — nuovo nome
- `ROLLBACK_AFFETTA_0501.cmd` — nuovo nome
- `scripts/apply-update-windows.ps1`
- `scripts/rollback-update-windows.ps1`
- `scripts/start-windows.ps1`
- `scripts/verify-engines-windows.ps1`
- `scripts/init.mjs`
- `scripts/live-production-selftest.mjs`

## Documentazione

- `README.md`
- `DIFF_SINTETICO.md`
- `REPORT_TEST_AUTOMATICI.md`
- `docs/CHANGELOG_V0.5.1.md`
- `docs/PARCO_MACCHINE_E_RUOLI.md`
- `docs/MATRICE_PARCO_MACCHINE.csv`
- `docs/FLEET_PROFILE_SELFTEST.json`
