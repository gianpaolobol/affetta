# Motori di slicing — Affetta v0.4.2

## Preparazione offline Windows

Il bundle contiene i pacchetti originali in `runtime\packages`. Eseguire:

```text
PREPARA_MOTORI_AFFETTA.cmd
```

Lo script:

1. verifica i quattro SHA-256;
2. estrae OrcaSlicer in `runtime\engines\orca`;
3. estrae Snapmaker Orca in `runtime\engines\snapmaker_orca`;
4. prepara PrusaSlicer in `runtime\engines\prusa`;
5. estrae amministrativamente Cura/CuraEngine in `runtime\engines\cura`;
6. controlla i preset macchina/processo/materiale;
7. genera e valida un G-code campione con ogni motore disponibile.

Non richiede il download degli slicer. La preparazione può richiedere privilegi Windows per l’estrazione MSI di Cura.

## Percorsi rilevati

Affetta cerca ricorsivamente:

- `prusa-slicer-console.exe`;
- `CuraEngine.exe` e `resources\definitions`;
- `orca-slicer.exe` e `resources\profiles`;
- `snapmaker-orca.exe` e `resources\profiles`.

È possibile impostare percorsi espliciti nel `.env`:

```env
PRUSA_SLICER_BIN=C:\percorso\prusa-slicer-console.exe
CURA_ENGINE_BIN=C:\percorso\CuraEngine.exe
ORCA_SLICER_BIN=C:\percorso\orca-slicer.exe
SNAPMAKER_ORCA_BIN=C:\percorso\snapmaker-orca.exe
```

## Assegnazione

- Prusa e RepRap: PrusaSlicer;
- LulzBot, Creality e Anycubic: CuraEngine con fallback Prusa;
- Bambu e Voron: OrcaSlicer;
- Snapmaker U1: Snapmaker Orca con fallback Orca standard.

## Verifica

```text
VERIFICA_MOTORI_AFFETTA.cmd
```

oppure:

```bash
npm run test:profiles
npm run test:engines
```

Il controllo preset verifica macchina, processo e filamento per ugelli e materiali supportati. Il controllo motori effettua lo slicing di `samples/cube20.stl`, analizza il G-code e verifica coordinate, temperature, tempo e materiale.
