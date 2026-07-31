# Affetta Standalone v0.4.2

## Correzione preparazione motori Windows

- sostituita l'estrazione fragile di `Expand-Archive` con `tar.exe` quando disponibile;
- rimossa automaticamente la cartella esterna dello ZIP Snapmaker Orca;
- ridotta la lunghezza dei percorsi interni;
- aggiunto fallback di estrazione in una cartella temporanea corta;
- aggiunto avviso quando Affetta è collocato in un percorso Windows troppo lungo;
- mantenuti checksum, routing, API e profili della v0.4.1.
