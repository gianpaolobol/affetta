# Thing-O-Matic  collaudo fisico pendente

## Stato software

La pipeline software è stata verificata fino alla generazione dellartefatto finale:

`STL  CuraEngine  G-code intermedio  validazione  GPX t6  X3G`

È stato generato correttamente un file `.x3g`.

La configurazione utilizza:

- origine macchina nellangolo `0,0`;
- area nominale `X 0100 mm`, `Y 0100 mm`, `Z 0100 mm`;
- estrusore Mk6 singolo;
- ugello da 0,35 mm;
- filamento da 2,85 mm;
- firmware Sailfish;
- conversione GPX con preset `t6`.

È stato corretto il doppio offset Cura che traslava il modello di ulteriori 50 mm su X e Y.

## Stato di validazione

Il collaudo fisico sulla stampante non è ancora stato eseguito.

Fino al completamento del collaudo devono rimanere validi:

- `profile_status: experimental`;
- `production_ready: false`;
- esclusione dal routing automatico degli ordini commerciali.

## Collaudo fisico da eseguire

Prima dellabilitazione produttiva verificare:

- homing e posizione reale dellorigine;
- direzione positiva degli assi X e Y;
- quota iniziale e direzione dellasse Z;
- corretta posizione del modello sul piano;
- riscaldamento del piano;
- temperatura dellestrusore;
- avanzamento e verso dellestrusore Mk6;
- primo strato;
- dimensioni di un cubo di calibrazione;
- arresto, fine stampa e movimenti di servizio;
- lettura del file X3G da SD e corretta esecuzione Sailfish.

Data dello stato software: 2 agosto 2026.
