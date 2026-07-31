# Affetta v0.4.8

## Correzione Snapmaker U1

- La route `snapmaker_orca` usa l'intero bundle OrcaSlicer 2.4.2: eseguibile e profili Snapmaker U1 inclusi.
- Non vengono più mescolati il parser Orca 2.4.2 con i preset Snapmaker Orca 2.3.5.
- Evitato l'errore `chamber_cooling_mode` e il crash headless del fork Snapmaker.
- Il self-test produce JSON puro, controlla la versione effettivamente installata e mostra il nome esatto della route fallita.
- CuraEngine resta diagnostico e non blocca i percorsi di produzione.
