# Affetta 0.5.2 — Thing-O-Matic e output X3G

Affetta 0.5.2 integra la pipeline sperimentale CuraEngine → GPX `t6` → X3G per MakerBot Thing-O-Matic e mantiene la separazione tra modelli pubblici, profili interni e unità fisiche del laboratorio.

## Novità principali

- `Profilo automatico laboratorio`: presente internamente, non visualizzato nella lista stampanti;
- `Profilo stima rapida Kiri:Moto`: presente internamente e usato solo per la stima preliminare;
- piani circolari reali nel viewer per Predator, V400, Delta WASP 2040, 2040 PRO e Turbo/Turbo2;
- profili pubblici LulzBot TAZ 4, TAZ 5, TAZ 6 e Mini prima generazione;
- unità private del laboratorio collegate ai modelli reali;
- `Prusa i3 autocostruita` rinominata senza suffisso;
- output X3G sperimentale per Thing-O-Matic Mk6/Sailfish.

## Sorgente GitHub e runtime esterno

Il ramo GitHub `main` contiene il codice sorgente, i profili, i test e la documentazione. Non contiene gli eseguibili dei motori, credenziali, upload, log, database o artefatti generati.

Percorsi consigliati su Windows:

```text
C:\AFFETTA_GITHUB_0412   clone sorgente
C:\AFFETTA_RUNTIME       motori esterni
C:\AFFETTA               installazione operativa, se presente
```

Il runtime deve restare esterno al repository. I percorsi dei motori vengono configurati nel file `.env` tramite `PRUSA_SLICER_BIN`, `CURA_ENGINE_BIN`, `GPX_BIN`, `ORCA_SLICER_BIN` e `SNAPMAKER_ORCA_BIN`.

## Setup sorgente su Windows

```powershell
git clone https://github.com/gianpaolobol/affetta.git C:\AFFETTA_GITHUB_0412
Set-Location C:\AFFETTA_GITHUB_0412
git checkout main
git pull --ff-only origin main
Copy-Item .env.example .env
npm install
npm test
npm start
```

Prima dei test live, compilare `.env` con i percorsi reali dei motori presenti in `C:\AFFETTA_RUNTIME`. I test statici e contrattuali non devono richiedere il runtime esterno.

## Stato produttivo

X1C e Snapmaker U1 restano abilitate. Le unità non collaudate restano `production_ready=false` fino alla verifica reale del motore e alla stampa fisica.

## Thing-O-Matic

La versione 0.5.2 aggiunge la pipeline CuraEngine → GPX `t6` → X3G per la Thing-O-Matic Mk6/Sailfish. I profili PLA, ABS, PETG e TPU sono sperimentali; la macchina resta esclusa dal routing produttivo automatico fino al collaudo fisico.

La generazione X3G è funzionante, ma il collaudo fisico è ancora pendente. Vedi `docs/THING_O_MATIC_PHYSICAL_VALIDATION_PENDING.md`.
