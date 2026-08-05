[CmdletBinding()]
param(
    [string]$RepoRoot = 'C:\AFFETTA_GITHUB_0412',
    [string]$RuntimeRoot = 'C:\AFFETTA_RUNTIME',
    [switch]$RotateToken
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$Builder = Join-Path $RepoRoot 'deployment\octobridge-lab-v2\fleet\Build-AffettaSourceOfflineBundle.ps1'
& $Builder -RepoRoot $RepoRoot -RuntimeRoot $RuntimeRoot -OnlyNode 'predator-01' -RotateTokens:$RotateToken
$Plan = Join-Path $RuntimeRoot 'provisioning\octobridge-lab-v2\current\nodes\predator-01\node-plan.json'
if (-not (Test-Path -LiteralPath $Plan -PathType Leaf)) { throw "Piano predator-01 mancante: $Plan" }
Write-Host ''
Write-Host '[PRONTO PER DOMANI] Predator 01' -ForegroundColor Green
Write-Host 'Hostname: affetta-predator-01'
Write-Host 'SD label: AFFETTA-PREDATOR-01'
Write-Host 'La stampa resta disabilitata fino al collaudo fisico.'
Write-Host "Piano: $Plan"
