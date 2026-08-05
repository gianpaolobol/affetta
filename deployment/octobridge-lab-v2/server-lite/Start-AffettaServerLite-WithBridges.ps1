[CmdletBinding()]
param(
    [string]$AffettaRoot = 'C:\AFFETTA_GITHUB_0412',
    [string]$RuntimeRoot = 'C:\AFFETTA_RUNTIME',
    [string]$ConfigPath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not $ConfigPath) {
    $ConfigPath = Join-Path $AffettaRoot 'server-lite\config\local-server.json'
}
$SecretsPath = Join-Path $RuntimeRoot 'secrets\octobridge-secrets.json'
$DataPath = Join-Path $RuntimeRoot 'server-lite'

if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
    throw "Configurazione Server Lite non trovata: $ConfigPath"
}
if (-not (Test-Path -LiteralPath $SecretsPath -PathType Leaf)) {
    throw "Segreti OctoBridge non trovati: $SecretsPath"
}

$secrets = Get-Content -LiteralPath $SecretsPath -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($property in $secrets.PSObject.Properties) {
    [Environment]::SetEnvironmentVariable($property.Name, [string]$property.Value, 'Process')
}

$env:AFFETTA_SERVER_LITE_CONFIG = $ConfigPath
$env:AFFETTA_SERVER_LITE_DATA_DIR = $DataPath

New-Item -ItemType Directory -Force -Path $DataPath | Out-Null
Set-Location $AffettaRoot

$node = Get-Command node -ErrorAction Stop
$npm = Get-Command npm -ErrorAction Stop

Write-Host "Node:       $($node.Source)"
Write-Host "npm:        $($npm.Source)"
Write-Host "Config:     $ConfigPath"
Write-Host "Dati:       $DataPath"
Write-Host "Bridge env: $($secrets.PSObject.Properties.Count)"
Write-Host ''

& $npm.Source run server-lite:start
exit $LASTEXITCODE
