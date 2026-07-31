# Affetta Standalone v0.4.0

## Backend slicing

- router multi-motore reale;
- adattatori PrusaSlicer, CuraEngine e OrcaSlicer;
- fallback per famiglia di firmware;
- rilevamento automatico di installazioni e build portatili;
- risorse Cura/Orca configurabili da `.env`;
- self-test dei motori reali.

## Profili automatici

- parametri derivati da stampante, ugello, materiale, qualità e resistenza;
- limiti termici e volumetrici;
- velocità e retrazione specifiche per macchina/materiale;
- supporti e adesione automatici;
- anteprima del profilo nella UI e nell’API;
- profilo applicato incluso nel risultato del job.

## Sicurezza e compatibilità

- nomi, percorsi e fallback dei motori rimangono nascosti ai client pubblici;
- API v1 esistenti mantenute;
- nuovo endpoint `/api/v1/profile-preview`;
- predisposizione Stampa3DBologna/Reborn invariata.
