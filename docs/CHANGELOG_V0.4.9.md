# Affetta v0.4.9

- Il launcher non riutilizza più automaticamente un server Affetta appartenente a una versione o cartella precedente.
- L'istanza viene identificata tramite `AFFETTA_INSTANCE_ID` e verificata nell'endpoint health.
- I percorsi di PrusaSlicer e OrcaSlicer vengono rilevati dentro `runtime/engines` e passati al server come percorsi assoluti.
- Le vecchie variabili `AFFETTA_ENGINE_COMMAND_*`, incompatibili con gli adattatori reali, vengono rimosse.
- Il launcher corregge automaticamente `PRUSA_SLICER_BIN`, `ORCA_SLICER_BIN` e `SNAPMAKER_ORCA_BIN` nel file `.env`.
- Aggiunto un collaudo live che attraversa il server HTTP realmente avviato e genera G-code per Prusa, Marlin, Bambu e Snapmaker U1.
