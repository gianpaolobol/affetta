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

$config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
$secrets = Get-Content -LiteralPath $SecretsPath -Raw -Encoding UTF8 | ConvertFrom-Json

$results = @()
foreach ($printer in @($config.printers | Where-Object { $_.adapter -eq 'octobridge' -and $_.enabled -ne $false })) {
    $tokenReference = [string]$printer.api_key
    if ($tokenReference -notmatch '^env:([A-Z0-9_]+)$') {
        $results += [pscustomobject]@{
            Id = $printer.id
            Nome = $printer.name
            Health = 'ERRORE'
            AuthStatus = 'ERRORE'
            Dettaglio = 'api_key non usa env:VAR'
        }
        continue
    }

    $variableName = $Matches[1]
    $secretProperty = $secrets.PSObject.Properties[$variableName]
    if ($null -eq $secretProperty) {
        $results += [pscustomobject]@{
            Id = $printer.id
            Nome = $printer.name
            Health = 'ERRORE'
            AuthStatus = 'ERRORE'
            Dettaglio = "Segreto mancante: $variableName"
        }
        continue
    }

    $health = 'KO'
    $authStatus = 'KO'
    $detail = ''
    try {
        $null = Invoke-RestMethod -Method Get -Uri "$($printer.endpoint)/health" -TimeoutSec 6
        $health = 'OK'

        $headers = @{ Authorization = "Bearer $([string]$secretProperty.Value)" }
        $status = Invoke-RestMethod -Method Get -Uri "$($printer.endpoint)/v1/status" -Headers $headers -TimeoutSec 10
        $pending = Invoke-RestMethod -Method Get -Uri "$($printer.endpoint)/v1/sync/pending" -Headers $headers -TimeoutSec 10
        $authStatus = 'OK'
        $detail = "bridge=$($status.bridge_id); machine=$($status.printer_snapshot.machine_status); job=$($status.printer_snapshot.job_status); pending=$(@($pending.jobs).Count)"
    }
    catch {
        $detail = $_.Exception.Message
    }

    $results += [pscustomobject]@{
        Id = $printer.id
        Nome = $printer.name
        Health = $health
        AuthStatus = $authStatus
        Dettaglio = $detail
    }
}

$results | Sort-Object Nome | Format-Table -AutoSize
if (@($results | Where-Object { $_.Health -ne 'OK' -or $_.AuthStatus -ne 'OK' }).Count -gt 0) {
    exit 1
}
exit 0
