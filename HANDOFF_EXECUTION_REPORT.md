# Rapporto di esecuzione — Affetta 0.5.1

## Richieste applicate

1. `Profilo automatico laboratorio` presente internamente e assente dalla lista stampanti.
2. `Profilo stima rapida Kiri:Moto` presente internamente e assente dalla lista stampanti.
3. Viewer circolare per Anycubic Predator, FLSUN V400, Delta WASP 2040, Delta WASP 2040 PRO e Delta WASP 2040 Turbo/Turbo2.
4. `Prusa i3 autocostruita` senza suffisso “profilo base”.
5. Profili LulzBot pubblici corretti: TAZ 4, TAZ 5, TAZ 6 e Mini prima generazione; unità private collegate ai modelli reali.

## Risultati

- 68/68 test Node superati;
- smoke test superato;
- 327 profili del parco verificati staticamente senza errori;
- catalogo HTTP verificato: i profili interni non sono pubblici;
- geometrie delta verificate nel catalogo e nel generatore grafico.

## Verifica ancora necessaria su Windows

I preset reali Orca/Snapmaker e i motori installati risiedono in `C:\AFFETTA\runtime`, escluso dal pacchetto. Dopo l’installazione devono essere eseguiti i collaudi forense, profili e motori del parco.
