param(
  [string]$SourceFolder = "$env:USERPROFILE\Downloads"
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Target = Join-Path $Root 'runtime\packages'
New-Item -ItemType Directory -Force -Path $Target | Out-Null

$Specs = @(
  @{ Name='PrusaSlicer-2.9.6-setup.exe'; Pattern='PrusaSlicer-2.9.6-setup*.exe'; Hash='6820d15f922908c3692cea2bdef7b5a2556fab1b7b55f4c312a89272b5eb8052' },
  @{ Name='OrcaSlicer_Windows_V2.4.2_x64_portable.zip'; Pattern='OrcaSlicer_Windows_V2.4.2_x64_portable*.zip'; Hash='feba3009dfb9d268779cca5758a1a5bc3b7d0722bf8fa48d5c57340de975d6be' },
  @{ Name='Snapmaker_Orca_Windows_V2.3.5_portable.zip'; Pattern='Snapmaker_Orca_Windows_V2.3.5_portable*.zip'; Hash='053fdbb622b0c20fb4de30a677a487786a992efebf82451e39cada9900aea169' },
  @{ Name='UltiMaker-Cura-5.13.0-win64-X64.msi'; Pattern='UltiMaker-Cura-5.13.0-win64-X64*.msi'; Hash='d049b1e9bd80adb2defbb76fcd8e5bfc395e297bd0141b4f2894e37d09d1c33c' }
)

if (-not (Test-Path -LiteralPath $SourceFolder)) {
  throw "Cartella non trovata: $SourceFolder"
}

Write-Host "Cerco i pacchetti in: $SourceFolder" -ForegroundColor Cyan
foreach ($Spec in $Specs) {
  $Candidates = Get-ChildItem -LiteralPath $SourceFolder -File -Recurse -Filter $Spec.Pattern -ErrorAction SilentlyContinue
  if (-not $Candidates) {
    throw "File non trovato: $($Spec.Pattern)"
  }
  $Selected = $null
  foreach ($Candidate in $Candidates) {
    $Hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $Candidate.FullName).Hash.ToLowerInvariant()
    if ($Hash -eq $Spec.Hash) {
      $Selected = $Candidate
      break
    }
  }
  if (-not $Selected) {
    $names = ($Candidates | ForEach-Object { $_.FullName }) -join '; '
    throw "Sono stati trovati file compatibili con $($Spec.Pattern), ma nessuno ha il checksum atteso. Trovati: $names"
  }
  $Destination = Join-Path $Target $Spec.Name
  Copy-Item -LiteralPath $Selected.FullName -Destination $Destination -Force
  Write-Host "Importato: $($Selected.Name) -> $($Spec.Name)" -ForegroundColor Green
}
Write-Host ''
Write-Host 'Tutti i pacchetti sono stati importati e verificati.' -ForegroundColor Green
