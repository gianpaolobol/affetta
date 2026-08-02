$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root
$Data = Join-Path $Root 'data'
New-Item -ItemType Directory -Force -Path $Data | Out-Null
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Resolve-ExecutablePath($Candidate) {
  if ($null -eq $Candidate) { return $null }
  if ($Candidate -is [string]) { return [string]$Candidate }
  foreach ($name in @('FullName','Path','Source','Definition')) {
    $property = $Candidate.PSObject.Properties[$name]
    if ($null -ne $property -and -not [string]::IsNullOrWhiteSpace([string]$property.Value)) { return [string]$property.Value }
  }
  return $null
}
function Find-NodePath {
  $runtimeNode = Get-ChildItem -LiteralPath (Join-Path $Root 'runtime') -Filter node.exe -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
  $path = Resolve-ExecutablePath $runtimeNode
  if ($path) { return $path }
  return Resolve-ExecutablePath (Get-Command node.exe -ErrorAction SilentlyContinue)
}

try {
  Write-Host 'AFFETTA v0.5.2 - VERIFICA RAPIDA DEI PERCORSI DI PRODUZIONE' -ForegroundColor Cyan
  Write-Host "Cartella: $Root"
  $nodePath = Find-NodePath
  if (-not $nodePath) { throw 'Node.js non trovato.' }

  Write-Host '1/3 - Controllo preset Orca (salvato nel file, senza stampa a video)...' -ForegroundColor Cyan
  $profileOutput = & $nodePath (Join-Path $Root 'scripts\profile-asset-selftest.mjs') 2>&1 | Out-String
  [IO.File]::WriteAllText((Join-Path $Data 'profile-selftest.json'), $profileOutput, $Utf8NoBom)
  if ($LASTEXITCODE -ne 0) { throw 'Verifica preset non superata.' }

  Write-Host '2/3 - Controllo matrice profili del laboratorio...' -ForegroundColor Cyan
  $fleetOutput = & $nodePath (Join-Path $Root 'scripts\fleet-profile-selftest.mjs') 2>&1 | Out-String
  [IO.File]::WriteAllText((Join-Path $Data 'fleet-profile-selftest-console.json'), $fleetOutput.Trim(), $Utf8NoBom)
  if ($LASTEXITCODE -ne 0) { throw 'Matrice profili laboratorio non superata.' }

  Write-Host '3/3 - Slicing reale: Prusa/Marlin, Bambu e Snapmaker...' -ForegroundColor Cyan
  $engineOutput = & $nodePath (Join-Path $Root 'scripts\engine-selftest.mjs') | Out-String
  $engineExit = $LASTEXITCODE
  $engineFile = Join-Path $Data 'engine-selftest.json'
  [IO.File]::WriteAllText($engineFile, $engineOutput.Trim(), $Utf8NoBom)

  try { $engineReport = $engineOutput | ConvertFrom-Json }
  catch { throw "Il nuovo engine-selftest.json non è JSON valido: $($_.Exception.Message)" }

  if ([string]$engineReport.version -ne '0.5.2') {
    throw "Self-test non aggiornato: rilevata versione $($engineReport.version), attesa 0.5.2. Verifica di aver sostituito i file in C:\AFFETTA."
  }

  foreach ($property in $engineReport.production_routes.PSObject.Properties) {
    $route = $property.Value
    if ($route.ok) {
      Write-Host ("  OK   {0} -> {1} ({2} byte)" -f $property.Name, $route.actual_provider, $route.gcode_bytes) -ForegroundColor Green
    } else {
      Write-Host ("  KO   {0}: {1}" -f $property.Name, $route.error) -ForegroundColor Red
    }
  }

  if ($engineExit -ne 0 -or -not $engineReport.summary.ok) {
    $failedNames = @($engineReport.production_routes.PSObject.Properties | Where-Object { -not $_.Value.ok } | ForEach-Object { $_.Name })
    throw ("Percorsi non superati: " + ($failedNames -join ', '))
  }

  Write-Host 'COLLAUDO PRODUZIONE COMPLETATO CON SUCCESSO.' -ForegroundColor Green
  exit 0
}
catch {
  Write-Host "ERRORE: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host 'Consulta data\engine-selftest.json.'
  exit 1
}
finally {
  Write-Host "`nPremi INVIO per chiudere."
  [void][System.Console]::ReadLine()
}
