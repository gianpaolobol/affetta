param(
    [string]$Target = 'C:\AFFETTA',
    [string]$Backup = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$TargetFull = [System.IO.Path]::GetFullPath($Target).TrimEnd('\\')
if (-not (Test-Path $TargetFull)) { throw "Installazione non trovata: $TargetFull" }
if (-not $Backup) {
    $pointer = Join-Path $TargetFull 'data\last-update-backup.txt'
    if (-not (Test-Path $pointer)) { throw 'Percorso backup non specificato e puntatore rollback assente.' }
    $Backup = (Get-Content $pointer -Raw).Trim()
}
if (-not (Test-Path $Backup)) { throw "Backup rollback non trovato: $Backup" }

$stopScript = Join-Path $TargetFull 'scripts\stop-windows.ps1'
if (Test-Path $stopScript) {
    try { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $stopScript | Out-Host } catch { Write-Warning $_.Exception.Message }
}

$replaceDirs = @('config','docs','integration','public','samples','scripts','src','test','tools')
$manifestPath = Join-Path $TargetFull 'data\update-0412-manifest.json'
if (Test-Path $manifestPath) {
    $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
    foreach ($name in @($manifest.installed_top_files)) {
        $candidate = Join-Path $TargetFull ([string]$name)
        if (Test-Path $candidate) { Remove-Item -LiteralPath $candidate -Force }
    }
}
foreach ($dir in $replaceDirs) {
    $destination = Join-Path $TargetFull $dir
    if (Test-Path $destination) { Remove-Item -LiteralPath $destination -Recurse -Force }
    $saved = Join-Path $Backup $dir
    if (Test-Path $saved) { Copy-Item -LiteralPath $saved -Destination $destination -Recurse -Force }
}
foreach ($item in Get-ChildItem -LiteralPath $Backup -Force -File) {
    Copy-Item -LiteralPath $item.FullName -Destination (Join-Path $TargetFull $item.Name) -Force
}
Write-Host ''
Write-Host 'ROLLBACK COMPLETATO.' -ForegroundColor Green
Write-Host "Ripristinato il codice da: $Backup"
Write-Host 'Le cartelle data, runtime e node_modules non sono state eliminate.'
