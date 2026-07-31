# Analisi causa radice — matrice Affetta 0.4.11

## Risultato reale analizzato

La matrice Windows ha eseguito 960 slicing reali:

- 672 superati;
- 288 falliti;
- processo server rimasto stabile;
- 4 errori di classificazione HTTP per quantità oltre il piano.

## Famiglia 1 — X1C e piatto incompatibile

128 job X1C fallivano con `Cool Plate does not support filament 1`.

Il preset processo ereditava `Cool Plate` anche per ABS, ASA, PETG e TPU. Affetta modificava temperature e materiale, ma non selezionava esplicitamente il tipo di piatto. La v0.4.12 associa il piatto al materiale:

- PLA → Cool Plate;
- PETG e TPU → Textured PEI Plate;
- ABS e ASA → High Temp Plate.

Le temperature originali del preset produttore vengono conservate quando valide; i valori Affetta sono usati soltanto se il preset selezionato contiene zero o nessun valore.

## Famiglia 2 — supporti organici e ugello 0,8 mm

160 job fallivano perché il diametro della punta del supporto organico era inferiore alla larghezza di estrusione del supporto:

- 80 X1C;
- 80 Snapmaker U1.

La v0.4.12 usa `normal(auto)` con ugello 0,8 mm e `tree(auto)` con ugelli più piccoli. Inoltre imposta larghezza supporto, diametro punta e diametro ramo in modo coerente con ugello e line width.

## Famiglia 3 — quantità oltre capacità

I quattro rifiuti attesi venivano classificati HTTP 500 perché gli errori geometrici non avevano `statusCode`. Ora `model_too_large`, `quantity_does_not_fit` e `arrangement_too_complex` restituiscono HTTP 422 con messaggio JSON leggibile.

## Famiglia 4 — statistiche G-code

Tutti i 672 casi formalmente superati riportavano tempi di soli 3–8 secondi. In 93 casi il G-code conteneva più di 100.000 movimenti; il massimo era 1.334.756 movimenti e 38.503.761 byte, ma il tempo riportato era 4 secondi.

Il parser precedente leggeva soltanto il primo numero di commenti come `estimated printing time = 1h 2m 3s`, interpretandolo come secondi. Ora supporta giorni, ore, minuti, secondi e formati `HH:MM:SS`, privilegiando il tempo totale dello slicer. Per il materiale usa i metadati `filament used [mm]` e `filament used [g]` quando presenti, evitando errori dovuti a `G92 E0`, estrusione relativa e reset dell'estrusore.
