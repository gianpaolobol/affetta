# Report test automatici — Affetta 0.5.1

## Superati

- suite Node: **68 test superati su 68**;
- smoke test HTTP/applicativo: superato;
- matrice statica parco macchine: **327 profili**, 0 errori;
- profili interni presenti e assenti dalla lista pubblica;
- catalogo LulzBot: TAZ 4, TAZ 5, TAZ 6, Mini e Mini 2 distinti;
- unità del laboratorio collegate a TAZ 4, TAZ 5, TAZ 6 e Mini prima generazione;
- viewer delta WebGL e Canvas: segmenti ritagliati nel diametro circolare;
- geometrie verificate: Predator Ø370, V400 Ø300, WASP/PRO Ø200;
- Prusa i3 autocostruita senza dicitura “profilo base”;
- installer/rollback Windows 0.5.1.

## Non verificabile nel pacchetto

`npm run test:profiles` richiede i preset Orca/Snapmaker presenti in `C:\AFFETTA\runtime`, esclusi dal pacchetto. Nel contenitore di test risultano quindi `profiles_missing`; il collaudo deve essere ripetuto sul PC Windows dopo l’aggiornamento.
