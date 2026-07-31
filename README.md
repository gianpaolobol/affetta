# Affetta v0.4.12 — correzione matrice profili

Build consolidata derivata dalla v0.4.11 e dai risultati reali di `RISULTATI_MATRICE_AFFETTA.zip`.

Corregge:

- incompatibilità X1C tra Cool Plate e ABS/ASA/PETG/TPU;
- errore Orca dei supporti organici con ugello 0,8 mm;
- risposta HTTP 500 per quantità oltre la capacità del piano;
- tempi e quantità di materiale incoerenti letti dai commenti G-code di Prusa/Orca.

## Applicazione

1. Estrarre il pacchetto in una cartella di staging diversa da `C:\AFFETTA`.
2. Eseguire `APPLICA_AFFETTA_0412.cmd`.
3. Avviare `C:\AFFETTA\AVVIA_AFFETTA.cmd`.
4. Eseguire `C:\AFFETTA\COLLAUDO_FORENSE_AFFETTA.cmd`.
5. Eseguire il collaudatore matrice v0.2 fornito separatamente.

Lo script preserva `.env`, `data`, `runtime` e `node_modules` e crea un backup automatico.
