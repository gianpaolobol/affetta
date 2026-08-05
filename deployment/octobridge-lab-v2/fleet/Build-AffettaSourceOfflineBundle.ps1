[CmdletBinding()]
param(
    [string]$RepoRoot = 'C:\AFFETTA_GITHUB_0412',
    [string]$RuntimeRoot = 'C:\AFFETTA_RUNTIME',
    [string]$OnlyNode,
    [switch]$RotateTokens
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$FleetTools = Join-Path $RepoRoot 'deployment\octobridge-lab-v2\fleet'
& (Join-Path $FleetTools 'New-AffettaFleetProvisioning.ps1') -RepoRoot $RepoRoot -RuntimeRoot $RuntimeRoot -RotateTokens:$RotateTokens
$Provisioning = Join-Path $RuntimeRoot 'provisioning\octobridge-lab-v2\current'
$Commit = (& git -C $RepoRoot rev-parse --short=12 HEAD).Trim()
$Timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$BundleRoot = Join-Path $RuntimeRoot ("offline\octobridge-lab-v2\AFFETTA_OCTOBRIDGE_SOURCE_{0}_{1}" -f $Commit, $Timestamp)
$SourceRoot = Join-Path $BundleRoot 'source\affetta'
New-Item -ItemType Directory -Force -Path $SourceRoot | Out-Null
Copy-Item -LiteralPath (Join-Path $RepoRoot 'octobridge-zero') -Destination (Join-Path $SourceRoot 'octobridge-zero') -Recurse -Force
Copy-Item -LiteralPath (Join-Path $RepoRoot 'deployment\octobridge-lab-v2') -Destination (Join-Path $SourceRoot 'deployment\octobridge-lab-v2') -Recurse -Force
Get-ChildItem -LiteralPath $BundleRoot -Directory -Recurse -Filter '__pycache__' | Remove-Item -Recurse -Force
Get-ChildItem -LiteralPath $BundleRoot -File -Recurse -Include '*.pyc' | Remove-Item -Force
$Index = Get-Content -LiteralPath (Join-Path $Provisioning 'fleet-provisioning-index.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$Nodes = @($Index.nodes)
if ($OnlyNode) {
    $Nodes = @($Nodes | Where-Object { $_.fleet_unit_id -eq $OnlyNode })
    if ($Nodes.Count -ne 1) { throw "Nodo non trovato: $OnlyNode" }
}
foreach ($Node in $Nodes) {
    $UnitId = [string]$Node.fleet_unit_id
    $NodeSource = Join-Path $Provisioning ('nodes\' + $UnitId)
    $NodeTarget = Join-Path $BundleRoot ('nodes\' + $UnitId)
    Copy-Item -LiteralPath $NodeSource -Destination $NodeTarget -Recurse -Force
    $Installer = 'install-' + $UnitId + '.sh'
    $InstallTemplate = @'
#!/usr/bin/env bash
set -Eeuo pipefail
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "${HERE}/../.." && pwd)"
API_FILE="${HERE}/secrets/octoprint-api-key.txt"
TOKEN_FILE="${HERE}/secrets/bridge-token.txt"
if [[ ! -s "${API_FILE}" ]] || grep -q '^INCOLLARE_QUI_' "${API_FILE}"; then
  echo 'Inserire prima la vera API key OctoPrint in secrets/octoprint-api-key.txt' >&2
  exit 1
fi
chmod 0600 "${API_FILE}" "${TOKEN_FILE}"
sudo bash "${ROOT}/source/affetta/deployment/octobridge-lab-v2/installers/__INSTALLER__" \
  --affetta-source "${ROOT}/source/affetta" \
  --octoprint-api-key-file "${API_FILE}" \
  --bridge-token-file "${TOKEN_FILE}" \
  --no-start
printf '\nInstallazione completata ma stampa NON abilitata. Eseguire il collaudo fisico.\n'
'@
    $InstallScript = $InstallTemplate.Replace('__INSTALLER__', $Installer)
    [System.IO.File]::WriteAllText((Join-Path $NodeTarget 'INSTALLA_NODO.sh'), $InstallScript, $Utf8NoBom)
}
$Files = @(Get-ChildItem -LiteralPath $BundleRoot -File -Recurse | Sort-Object FullName)
$Lines = foreach ($File in $Files) {
    $Relative = $File.FullName.Substring($BundleRoot.Length + 1).Replace('\\','/')
    '{0}  {1}' -f (Get-FileHash -LiteralPath $File.FullName -Algorithm SHA256).Hash.ToLowerInvariant(), $Relative
}
[System.IO.File]::WriteAllLines((Join-Path $BundleRoot 'SHA256SUMS.txt'), $Lines, $Utf8NoBom)
$ZipPath = $BundleRoot + '.zip'
Compress-Archive -LiteralPath $BundleRoot -DestinationPath $ZipPath -CompressionLevel Optimal -Force
Write-Host '[OK] Bundle sorgente offline creato.' -ForegroundColor Green
Write-Host "Cartella: $BundleRoot"
Write-Host "ZIP:      $ZipPath"
Write-Host 'Nota: i sorgenti sono offline; apt e l’installazione iniziale di OctoPrint possono richiedere Internet.'
