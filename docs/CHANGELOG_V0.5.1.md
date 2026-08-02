# Affetta 0.5.1 — profili interni e piani delta

## Modifiche

- `Profilo automatico laboratorio` spostato nel catalogo interno e rimosso dalla lista pubblica delle stampanti.
- aggiunto `Profilo stima rapida Kiri:Moto`, interno e non selezionabile come stampante;
- Kiri:Moto legge ora la propria configurazione dal profilo interno anziché da valori hardcoded;
- viewer WebGL e fallback Canvas mostrano piani circolari reali per Anycubic Predator, FLSUN V400, Delta WASP 2040, Delta WASP 2040 PRO e Delta WASP 2040 Turbo/Turbo2;
- il diametro del piano viene letto da `build_diameter_mm`;
- aggiunti profili pubblici distinti LulzBot TAZ 4, TAZ 5, TAZ 6 e LulzBot Mini prima generazione;
- il parco privato collega le unità fisiche ai modelli reali;
- rimossi i profili pubblici legacy con etichetta “laboratorio”;
- rinominata `Prusa i3 autocostruita (profilo base)` in `Prusa i3 autocostruita`;
- installer e rollback aggiornati alla 0.5.1.

## Sicurezza

Le nuove unità LulzBot restano `production_ready=false` fino al collaudo fisico di toolhead, ugello, firmware e start/end G-code.
