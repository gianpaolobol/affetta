[CmdletBinding()]
param(
    [string]$RepoRoot = 'C:\AFFETTA_GITHUB_0412',
    [string]$RuntimeRoot = 'C:\AFFETTA_RUNTIME',
    [switch]$RotateTokens
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$PackageRoot = Join-Path $RepoRoot 'deployment\octobridge-lab-v2'
$IndexPath = Join-Path $PackageRoot 'machines\index.json'
$SecretsDirectory = Join-Path $RuntimeRoot 'secrets'
$SecretsPath = Join-Path $SecretsDirectory 'octobridge-fleet-preprovisioning.json'
$TargetRoot = Join-Path $RuntimeRoot 'provisioning\octobridge-lab-v2\current'
$TemporaryRoot = Join-Path $RuntimeRoot ('provisioning\octobridge-lab-v2\.building-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))

function Write-JsonNoBom([string]$Path, $Value, [int]$Depth = 30) {
    $Parent = Split-Path -Parent $Path
    New-Item -ItemType Directory -Force -Path $Parent | Out-Null
    [System.IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth $Depth), $Utf8NoBom)
}
function Write-TextNoBom([string]$Path, [string]$Value) {
    $Parent = Split-Path -Parent $Path
    New-Item -ItemType Directory -Force -Path $Parent | Out-Null
    [System.IO.File]::WriteAllText($Path, $Value, $Utf8NoBom)
}
function New-HexToken {
    $Bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($Bytes)
    return -join ($Bytes | ForEach-Object { $_.ToString('x2') })
}
function Get-TokenEnvironmentName([string]$UnitId) {
    return 'AFFETTA_OCTOBRIDGE_' + (($UnitId.ToUpperInvariant() -replace '[^A-Z0-9]+', '_').Trim('_')) + '_TOKEN'
}

if (-not (Test-Path -LiteralPath $IndexPath -PathType Leaf)) { throw "Indice macchine non trovato: $IndexPath" }
$Index = Get-Content -LiteralPath $IndexPath -Raw -Encoding UTF8 | ConvertFrom-Json
$Machines = @($Index.machines)
if ($Machines.Count -ne 12) { throw "Attese 12 macchine, trovate $($Machines.Count)." }

New-Item -ItemType Directory -Force -Path $SecretsDirectory | Out-Null
$Tokens = @{}
if ((Test-Path -LiteralPath $SecretsPath -PathType Leaf) -and -not $RotateTokens) {
    $Existing = Get-Content -LiteralPath $SecretsPath -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($Property in $Existing.PSObject.Properties) { $Tokens[$Property.Name] = [string]$Property.Value }
}
foreach ($Machine in $Machines) {
    $EnvironmentName = Get-TokenEnvironmentName ([string]$Machine.fleet_unit_id)
    if ($RotateTokens -or -not $Tokens.ContainsKey($EnvironmentName) -or $Tokens[$EnvironmentName].Length -lt 32) {
        $Tokens[$EnvironmentName] = New-HexToken
    }
}
$OrderedTokens = [ordered]@{}
foreach ($Key in ($Tokens.Keys | Sort-Object)) { $OrderedTokens[$Key] = $Tokens[$Key] }
Write-JsonNoBom -Path $SecretsPath -Value $OrderedTokens -Depth 5

Remove-Item -LiteralPath $TemporaryRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $TemporaryRoot | Out-Null
$FleetIndex = [System.Collections.Generic.List[object]]::new()
foreach ($MachineSummary in $Machines) {
    $UnitId = [string]$MachineSummary.fleet_unit_id
    $ManifestPath = Join-Path $PackageRoot ('machines\' + [string]$MachineSummary.manifest)
    $Machine = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $EnvironmentName = Get-TokenEnvironmentName $UnitId
    $Token = [string]$Tokens[$EnvironmentName]
    $NodeRoot = Join-Path $TemporaryRoot ('nodes\' + $UnitId)
    $SecretRoot = Join-Path $NodeRoot 'secrets'
    New-Item -ItemType Directory -Force -Path $SecretRoot | Out-Null
    Copy-Item -LiteralPath $ManifestPath -Destination (Join-Path $NodeRoot 'machine.json') -Force
    Write-TextNoBom -Path (Join-Path $SecretRoot 'bridge-token.txt') -Value ($Token + "`n")
    Write-TextNoBom -Path (Join-Path $SecretRoot 'octoprint-api-key.txt') -Value "INCOLLARE_QUI_LA_API_KEY_OCTOPRINT_E_RIMUOVERE_QUESTA_RIGA`n"
    $Registration = [ordered]@{
        schema_version = 'affetta.server-lite-octobridge-registration.v1'
        generated_by = 'AFFETTA_P4_4_3_FLEET_READINESS'
        printer = [ordered]@{
            id = $UnitId
            name = [string]$Machine.display_name
            model = [string]$Machine.model
            adapter = 'octobridge'
            enabled = $true
            endpoint = ('http://{0}.local:8792' -f [string]$Machine.hostname)
            api_key = ('env:' + $EnvironmentName)
            options = [ordered]@{
                bridge_id = [string]$Machine.bridge_id
                printer_profile_id = [string]$Machine.printer_profile_id
                release_channel = 'experimental'
                production_ready = $false
            }
        }
        secret = [ordered]@{ environment_variable = $EnvironmentName; value = $Token }
        bridge = [ordered]@{
            bridge_id = [string]$Machine.bridge_id
            fleet_unit_id = $UnitId
            hostname = [string]$Machine.hostname
            local_endpoint = ('http://{0}.local:8792' -f [string]$Machine.hostname)
        }
    }
    Write-JsonNoBom -Path (Join-Path $NodeRoot ($UnitId + '.server-lite-registration.json')) -Value $Registration
    $Plan = [ordered]@{
        schema_version = 'affetta.sd-node-plan.v1'
        production_ready = $false
        hardware_validation_pending = $true
        fleet_unit_id = $UnitId
        display_name = [string]$Machine.display_name
        hostname = [string]$Machine.hostname
        bridge_id = [string]$Machine.bridge_id
        printer_profile_id = [string]$Machine.printer_profile_id
        raspberry_model = $null
        raspberry_revision = $null
        raspberry_serial = $null
        mac_address = $null
        reserved_ip = $null
        sd_label = ('AFFETTA-' + $UnitId.ToUpperInvariant())
        serial_by_id = $null
        physical_printer_label_confirmed = $false
    }
    Write-JsonNoBom -Path (Join-Path $NodeRoot 'node-plan.json') -Value $Plan
    Write-TextNoBom -Path (Join-Path $NodeRoot 'LABEL.txt') -Value @"
AFFETTA OCTOBRIDGE
Unità: $UnitId
Stampante: $($Machine.display_name)
Hostname: $($Machine.hostname).local
Bridge: $($Machine.bridge_id)
SD: AFFETTA-$($UnitId.ToUpperInvariant())
production_ready=false
"@
    Write-TextNoBom -Path (Join-Path $NodeRoot 'FIRST_BOOT.txt') -Value @"
1. Scrivere l'immagine prevista dal piano SD.
2. Configurare hostname: $($Machine.hostname)
3. Abilitare SSH e rete.
4. Installare/configurare OctoPrint.
5. Copiare il bundle sorgente Affetta sul Raspberry.
6. Inserire la vera API key in secrets/octoprint-api-key.txt.
7. Eseguire INSTALLA_NODO.sh dal bundle del nodo.
8. Non abilitare la stampa finché USB, seriale e direzioni non sono validate.
"@
    $FleetIndex.Add([pscustomobject]@{
        fleet_unit_id = $UnitId
        hostname = [string]$Machine.hostname
        bridge_id = [string]$Machine.bridge_id
        token_environment = $EnvironmentName
        node_directory = ('nodes/' + $UnitId)
        production_ready = $false
    })
}
Write-JsonNoBom -Path (Join-Path $TemporaryRoot 'fleet-provisioning-index.json') -Value ([ordered]@{
    schema_version = 'affetta.fleet-preprovisioning.v1'
    generated_at = (Get-Date).ToString('o')
    production_ready = $false
    hardware_validation_pending = $true
    nodes = @($FleetIndex)
})

Remove-Item -LiteralPath $TargetRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $TargetRoot) | Out-Null
Move-Item -LiteralPath $TemporaryRoot -Destination $TargetRoot
$currentIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $SecretsPath '/inheritance:r' "/grant:r" "${currentIdentity}:(M)" 'SYSTEM:(F)' | Out-Null
& icacls.exe $TargetRoot '/inheritance:r' "/grant:r" "${currentIdentity}:(OI)(CI)(M)" 'SYSTEM:(OI)(CI)(F)' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Impossibile proteggere il provisioning con ACL.' }
Write-Host '[OK] Provisioning creato per 12 nodi.' -ForegroundColor Green
Write-Host "Directory: $TargetRoot"
Write-Host "Token:     $SecretsPath"
Write-Host 'Le chiavi OctoPrint restano volutamente da inserire al primo avvio.'
