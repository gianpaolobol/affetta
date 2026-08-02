# Profili Affetta 0.5.1 e calibrazione fisica

## Profili generati

Affetta compone i profili da:

- unità fisica;
- modello stampante;
- diametro ugello;
- diametro filamento;
- materiale assegnato;
- qualità;
- resistenza;
- quantità e disposizione sul piano.

Il self-test statico verifica tutte le combinazioni assegnate e salva `data/fleet-profile-selftest.json`.

## Tre qualità pubbliche future

| Scelta | Profilo Affetta |
|---|---|
| Bozza | `draft` |
| Standard | `standard` |
| Dettaglio | `high` |

`ultra` rimane disponibile solo internamente per macchine e lavori compatibili.

## Tre resistenze pubbliche future

| Scelta | Profilo Affetta |
|---|---|
| Leggera | `light` |
| Standard | `standard` |
| Resistente | `strong` |

`solid` rimane interno per casi speciali; non equivale automaticamente al 100% di riempimento economicamente conveniente.

## Stati di sicurezza

- `pending-physical-calibration`: profilo generato, non selezionabile dal router produttivo.
- `physical-validated`: unità selezionabile automaticamente.
- `manual-slicer-calibration`: processo presente ma non automatizzato, come la Phrozen.
- `requires-machine-inventory`: dati fisici mancanti, come le Prusa autocostruite.

## Collaudi

1. `COLLAUDA_PROFILI_LABORATORIO.cmd` — verifica tutte le composizioni senza avviare gli slicer.
2. `COLLAUDA_MOTORI_PARCO_MACCHINE.cmd` — genera e valida un cubo con il motore reale per ogni unità/profilo assegnato.
3. Stampa fisica per ogni unità: primo layer, cubo, retrazione, tolleranze e piccolo pezzo con supporti.
4. Solo dopo la verifica fisica impostare `production_ready=true` in `config/fleet.json`.

## Parametri da registrare per ogni unità

- modello e revisione esatti;
- firmware;
- tipo di estrusore/toolhead;
- ugello realmente montato;
- start/end G-code già collaudato;
- accelerazioni e velocità affidabili;
- retrazione per materiale;
- dimensioni realmente utilizzabili del piano;
- eventuale enclosure;
- piatto e adesione;
- materiale abitualmente caricato.

Non stampare automaticamente un G-code di un profilo `pending-physical-calibration` senza averne prima controllato start/end G-code e limiti macchina.
