# Diff sintetico — Affetta 0.4.11 → 0.4.12

## Profilazione Orca

- aggiunto `bed_type_by_material` per X1C;
- aggiunto `curr_bed_type` nel processo Orca;
- aggiunti support type e dimensioni supporti coerenti;
- preservate le temperature vendor non nulle.

## API

- `model_too_large`, `quantity_does_not_fit` e `arrangement_too_complex`: HTTP 422.

## Statistiche

- parser durata completo;
- metadati filamento preferiti ai comandi E;
- origine della stima esposta nel risultato.

## Interfaccia

- visualizzazione del piatto selezionato automaticamente.

## Test

- 56/56 superati;
- 640/640 combinazioni Orca validate staticamente;
- test HTTP quantità e stabilità server.
