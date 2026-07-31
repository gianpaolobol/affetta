# Affetta v0.4.4

- Corretta la CLI OrcaSlicer/Snapmaker Orca: `--ensure-on-bed` è un flag senza valore; il precedente `1` veniva interpretato come nome file e causava `No such file: 1`.
- Resa robusta la ricerca delle definizioni Cura dopo l'estrazione amministrativa MSI.
- Aggiunta ricerca ricorsiva di `definitions/fdmprinter.def.json` nel runtime Cura.
- Migliorata la ricerca di fallback delle cartelle profili Orca.
- Nessuna reinstallazione dei motori richiesta.
