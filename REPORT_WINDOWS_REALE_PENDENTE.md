# Verifica Windows reale pendente

Le cause osservate nella matrice 0.4.11 sono state corrette e coperte da test automatici. Non è possibile dichiarare 960/960 slicing reali superati senza eseguire nuovamente la matrice sul computer Windows che contiene i runtime e i profili effettivi.

Dopo l'aggiornamento:

1. eseguire `COLLAUDO_FORENSE_AFFETTA.cmd`;
2. eseguire il collaudatore matrice v0.2;
3. verificare che il riepilogo riporti 960 superati, 0 falliti e 0 errori API;
4. controllare manualmente almeno un G-code per Prusa MK4, X1C e Snapmaker U1.
