# Parco macchine Stampa3DBologna — ruoli proposti

## Criterio di specializzazione

I modelli stampante sono pubblici e riutilizzabili da qualunque utente; le singole unità del laboratorio restano entità private del router Service.

| Unità privata | Modello pubblico | Impiego prevalente | Ugello base | Materiali assegnati | Slicer primario |
|---|---|---|---:|---|---|
| LulzBot TAZ 4 | LulzBot TAZ 4 | produzione generale e piccoli lotti | 0,5 | PLA, PETG | CuraEngine |
| LulzBot TAZ 5 | LulzBot TAZ 5 | flessibili | 0,5 | TPU | CuraEngine |
| LulzBot TAZ 6 | LulzBot TAZ 6 | pezzi grandi e resistenti | 0,8 | PLA, PETG | CuraEngine |
| LulzBot Mini A | LulzBot Mini | pezzi piccoli e accurati | 0,5 | PLA, PETG | CuraEngine |
| LulzBot Mini B | LulzBot Mini | piccoli flessibili e lavori brevi | 0,5 | TPU, PLA | CuraEngine |
| Delta WASP 2040 1 | Delta WASP 2040 | pezzi alti e dettaglio | 0,4 | PLA, PETG | PrusaSlicer |
| Delta WASP 2040 2 | Delta WASP 2040 | pezzi alti e robusti | 0,7 | PLA, PETG | PrusaSlicer |
| Delta WASP 2040 3 | Delta WASP 2040 | capacità generale/overflow | 0,4 | PLA, PETG, TPU | PrusaSlicer |
| Delta WASP 2040 Turbo 1 | Delta WASP 2040 Turbo/Turbo2 | tecnopolimeri e dettaglio | 0,4 | ABS, ASA, PETG | PrusaSlicer |
| Delta WASP 2040 Turbo 2 | Delta WASP 2040 Turbo/Turbo2 | tecnopolimeri e pezzi rapidi | 0,7 | ABS, ASA, PETG, PLA | PrusaSlicer |
| Snapmaker U1 | Snapmaker U1 | colore definito, multicolore e dettaglio | 0,4 | PLA, PETG, TPU | OrcaSlicer |
| Bambu Lab X1C | Bambu Lab X1C | tecnopolimeri, rapidità e colore definito | 0,4 | PLA, PETG, ABS, ASA, TPU | OrcaSlicer |
| Anycubic Predator 1 | Anycubic Predator | grandissimo formato e pezzi grossolani | 1,0 | PLA, PETG | CuraEngine |
| Anycubic Predator 2 | Anycubic Predator | grande formato generale | 0,6 | PLA, PETG, TPU | CuraEngine |
| FLSUN V400 | FLSUN V400 | pezzi alti e rapidi | 0,4 | PLA, PETG, TPU | OrcaSlicer |
| Phrozen Sonic Mini 4K | Phrozen Sonic Mini 4K | miniature e altissimo dettaglio | — | resina | CHITUBOX, manuale |
| Pool Prusa i3 autocostruite | Prusa i3 autocostruita | overflow | da definire | PLA, PETG | PrusaSlicer |

## Profili interni non pubblici

- `Profilo automatico laboratorio`: router produttivo Stampa3DBologna/Reborn.
- `Profilo stima rapida Kiri:Moto`: stima commerciale preliminare, non G-code definitivo.

## Geometrie del piano

- Anycubic Predator: Ø 370 × 455 mm.
- FLSUN V400: Ø 300 × 410 mm.
- Delta WASP 2040: Ø 200 × 400 mm.
- Delta WASP 2040 PRO: Ø 200 × 400 mm.
- Delta WASP 2040 Turbo/Turbo2: Ø 200 × 400 mm.

## Diametro filamento

- LulzBot TAZ 4, TAZ 5, TAZ 6 e Mini: 2,85 mm.
- Altre stampanti FDM: 1,75 mm.
- Phrozen: processo MSLA, senza filamento.

## Validazione ancora necessaria

TAZ 4, TAZ 5, TAZ 6 e Mini devono essere verificate sulle unità reali per toolhead, ugello montato, firmware, homing, start/end G-code e retrazione. Restano escluse dal routing produttivo fino a `production_ready=true`.
