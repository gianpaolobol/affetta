[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$SourceDirectory,

    [string]$AffettaRoot = 'C:\AFFETTA_GITHUB_0412',

    [string]$ConfigPath,

    [string]$RuntimeRoot = 'C:\AFFETTA_RUNTIME'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Utf8NoBom {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [string]$Content
    )
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

if (-not $ConfigPath) {
    $ConfigPath = Join-Path $AffettaRoot 'server-lite\config\local-server.json'
}

$ExamplePath = Join-Path $AffettaRoot 'server-lite\config\local-server.example.json'
$SecretsDirectory = Join-Path $RuntimeRoot 'secrets'
$SecretsPath = Join-Path $SecretsDirectory 'octobridge-secrets.json'

if (-not (Test-Path -LiteralPath $SourceDirectory -PathType Container)) {
    throw "Cartella registrazioni non trovata: $SourceDirectory"
}
if (-not (Test-Path -LiteralPath $ExamplePath -PathType Leaf)) {
    throw "Configurazione di esempio Server Lite non trovata: $ExamplePath"
}

$ConfigDirectory = Split-Path -Parent $ConfigPath
New-Item -ItemType Directory -Force -Path $ConfigDirectory | Out-Null
New-Item -ItemType Directory -Force -Path $SecretsDirectory | Out-Null

if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
    Copy-Item -LiteralPath $ExamplePath -Destination $ConfigPath
}

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
Copy-Item -LiteralPath $ConfigPath -Destination "$ConfigPath.backup-$timestamp"

$config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($null -eq $config.printers) {
    $config | Add-Member -MemberType NoteProperty -Name printers -Value @()
}

$printers = [System.Collections.ArrayList]::new()
foreach ($printer in @($config.printers)) {
    [void]$printers.Add($printer)
}

$secrets = @{}
if (Test-Path -LiteralPath $SecretsPath -PathType Leaf) {
    $existingSecrets = Get-Content -LiteralPath $SecretsPath -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($property in $existingSecrets.PSObject.Properties) {
        $secrets[$property.Name] = [string]$property.Value
    }
}

$files = @(Get-ChildItem -LiteralPath $SourceDirectory -Filter '*.server-lite-registration.json' -File)
if ($files.Count -eq 0) {
    throw "Nessuna registrazione trovata in $SourceDirectory"
}

foreach ($file in $files) {
    $registration = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
    $printer = $registration.printer
    $secret = $registration.secret

    if ([string]::IsNullOrWhiteSpace([string]$printer.id)) {
        throw "Registrazione priva di printer.id: $($file.FullName)"
    }
    if ([string]::IsNullOrWhiteSpace([string]$secret.environment_variable) -or
        [string]::IsNullOrWhiteSpace([string]$secret.value)) {
        throw "Registrazione priva di secret valido: $($file.FullName)"
    }

    for ($index = $printers.Count - 1; $index -ge 0; $index--) {
        if ([string]$printers[$index].id -eq [string]$printer.id) {
            $printers.RemoveAt($index)
        }
    }

    [void]$printers.Add($printer)
    $secrets[[string]$secret.environment_variable] = [string]$secret.value
    Write-Host "Importata: $($printer.id) — $($printer.name)"
}

$config.printers = @($printers | Sort-Object { [string]$_.name })
Write-Utf8NoBom -Path $ConfigPath -Content ($config | ConvertTo-Json -Depth 30)

$secretsObject = [ordered]@{}
foreach ($key in ($secrets.Keys | Sort-Object)) {
    $secretsObject[$key] = $secrets[$key]
}
Write-Utf8NoBom -Path $SecretsPath -Content ($secretsObject | ConvertTo-Json -Depth 5)

$currentIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $SecretsPath '/inheritance:r' "/grant:r" "${currentIdentity}:(M)" 'SYSTEM:(F)' | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "Impossibile applicare ACL restrittive a $SecretsPath"
}

Write-Host ''
Write-Host "Configurazione aggiornata: $ConfigPath"
Write-Host "Segreti protetti:          $SecretsPath"
Write-Host "Backup:                    $ConfigPath.backup-$timestamp"
Write-Host ''
Write-Host 'Avviare Server Lite con Start-AffettaServerLite-WithBridges.ps1.'
