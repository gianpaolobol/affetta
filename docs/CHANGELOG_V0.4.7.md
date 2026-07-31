# Affetta v0.4.7

- Corretto definitivamente OrcaSlicer: `--allow-newer-file` è un flag booleano e non riceve `1`.
- Snapmaker U1 usa OrcaSlicer CLI con i preset ufficiali Snapmaker già verificati.
- Le stampanti Marlin aperte usano PrusaSlicer come percorso primario affidabile.
- CuraEngine CLI resta opzionale/diagnostico e non può più bloccare il funzionamento di Affetta.
- Self-test ridotto ai percorsi realmente usati in produzione e output JSON UTF-8.
- Migliorata la CLI Cura con ricerca congiunta definitions/extruders e set minimo completo.
