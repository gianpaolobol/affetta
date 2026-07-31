# Affetta v0.4.5

- Corretto l'adattatore Orca/Snapmaker Orca: conserva nomi e metadati dei preset ufficiali, mantiene `filament_type` come array e non usa più un `datadir` vuoto.
- La CLI Orca usa la modalità ufficiale `--slice 0 --outputdir` e raccoglie G-code o Gcode.3MF.
- Aggiunta diagnostica completa in `data/engine-debug` in caso di errore Orca.
- Corretto l'ordine degli stack CuraEngine: impostazioni globali prima di `-e0`, filamento/estrusore dopo `-e0`, posizione mesh prima di `-l`.
- CuraEngine rifiuta G-code contenenti solo start/end senza percorsi di stampa, attivando il fallback sicuro.
