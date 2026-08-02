param(
    [string]$Target = 'C:\AFFETTA'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$Source = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Source = (Resolve-Path $Source).Path
$TargetFull = [System.IO.Path]::GetFullPath($Target).TrimEnd('\\')
if ($Source.TrimEnd('\\') -ieq $TargetFull) {
    throw 'Esegui l’aggiornamento da una cartella di staging diversa da C:\AFFETTA.'
}
if (-not (Test-Path $TargetFull)) { throw "Installazione Affetta non trovata: $TargetFull" }
if (-not (Test-Path (Join-Path $TargetFull 'VERSION'))) { throw "La cartella non sembra un’installazione Affetta: $TargetFull" }
if ((Get-Content (Join-Path $Source 'VERSION') -Raw).Trim() -ne '0.5.1') { throw 'Pacchetto aggiornamento non valido: VERSION diversa da 0.5.1.' }

$timestamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$parent = Split-Path -Parent $TargetFull
$Backup = Join-Path $parent "AFFETTA_BACKUP_PRE_0501_$timestamp"
$replaceDirs = @('config','docs','integration','public','samples','scripts','src','test','tools')
$protectedNames = @('.env','data','runtime','node_modules')
$obsoleteFiles = @(
    'APPLICA_AFFETTA_0411.cmd','ROLLBACK_AFFETTA_0411.cmd','APPLICA_AFFETTA_0412.cmd','ROLLBACK_AFFETTA_0412.cmd',
    'APPLICA_AFFETTA_0500.cmd','ROLLBACK_AFFETTA_0500.cmd',
    'APPLICA_CORREZIONE_DEFINITIVA_047.cmd','APPLICA_CORREZIONE_SNAPMAKER_048.cmd',
    'APPLICA_HOTFIX_044_E_VERIFICA.cmd','APPLICA_HOTFIX_045_E_VERIFICA.cmd','APPLICA_HOTFIX_046_E_VERIFICA.cmd',
    'LEGGIMI_049R1.txt','LEGGIMI_049R2.txt','LEGGIMI_CORREZIONE_047.txt','LEGGIMI_CORREZIONE_048.txt',
    'LEGGIMI_HOTFIX.md','LEGGIMI_HOTFIX.txt','LEGGIMI_HOTFIX_049.txt','LEGGIMI_HOTFIX_V0.4.4.txt',
    'LEGGIMI_HOTFIX_V0.4.5.txt','LEGGIMI_HOTFIX_V0.4.6.txt','RIPARA_AVVIO_AFFETTA_049R1.cmd',
    'RIPARA_AVVIO_AFFETTA_049R2.cmd','RIPARA_MOTORI_AFFETTA.cmd','RIPRISTINA_AVVIO_AFFETTA_049.cmd'
)

Write-Host "Arresto Affetta in $TargetFull..." -ForegroundColor Cyan
$stopScript = Join-Path $TargetFull 'scripts\stop-windows.ps1'
if (Test-Path $stopScript) {
    try { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $stopScript | Out-Host } catch { Write-Warning $_.Exception.Message }
}

Write-Host "Creo backup rollback: $Backup" -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $Backup | Out-Null
foreach ($dir in $replaceDirs) {
    $sourceItem = Join-Path $TargetFull $dir
    if (Test-Path $sourceItem) { Copy-Item -LiteralPath $sourceItem -Destination (Join-Path $Backup $dir) -Recurse -Force }
}
foreach ($item in Get-ChildItem -LiteralPath $TargetFull -Force -File) {
    Copy-Item -LiteralPath $item.FullName -Destination (Join-Path $Backup $item.Name) -Force
}

$installedTopFiles = @()
foreach ($item in Get-ChildItem -LiteralPath $Source -Force -File) {
    if ($protectedNames -contains $item.Name) { continue }
    $installedTopFiles += $item.Name
}
$manifest = [ordered]@{
    version = '0.5.1'
    applied_at = (Get-Date).ToString('o')
    source = $Source
    target = $TargetFull
    backup = $Backup
    replaced_directories = $replaceDirs
    installed_top_files = $installedTopFiles
    protected = $protectedNames
}

Write-Host 'Sostituisco il solo codice, preservando .env, data, runtime e node_modules...' -ForegroundColor Cyan
foreach ($dir in $replaceDirs) {
    $destination = Join-Path $TargetFull $dir
    if (Test-Path $destination) { Remove-Item -LiteralPath $destination -Recurse -Force }
    $sourceItem = Join-Path $Source $dir
    if (Test-Path $sourceItem) { Copy-Item -LiteralPath $sourceItem -Destination $destination -Recurse -Force }
}
foreach ($item in Get-ChildItem -LiteralPath $Source -Force -File) {
    if ($protectedNames -contains $item.Name) { continue }
    Copy-Item -LiteralPath $item.FullName -Destination (Join-Path $TargetFull $item.Name) -Force
}
foreach ($name in $obsoleteFiles) {
    $candidate = Join-Path $TargetFull $name
    if (Test-Path $candidate) { Remove-Item -LiteralPath $candidate -Force }
}

$dataDir = Join-Path $TargetFull 'data'
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
$pointer = Join-Path $dataDir 'last-update-backup.txt'
Set-Content -LiteralPath $pointer -Value $Backup -Encoding UTF8
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $dataDir 'update-0501-manifest.json') -Encoding UTF8

$installedVersion = (Get-Content (Join-Path $TargetFull 'VERSION') -Raw).Trim()
if ($installedVersion -ne '0.5.1') { throw "Verifica finale fallita: VERSION=$installedVersion" }
Write-Host ''
Write-Host 'AGGIORNAMENTO AFFETTA 0.5.1 APPLICATO.' -ForegroundColor Green
Write-Host "Backup rollback: $Backup"
Write-Host 'Ora esegui AVVIA_AFFETTA.cmd e poi COLLAUDO_FORENSE_AFFETTA.cmd e COLLAUDA_PROFILI_LABORATORIO.cmd.'
