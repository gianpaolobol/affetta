$ErrorActionPreference = 'SilentlyContinue'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$PidFile = Join-Path $Root 'data\affetta.pid'
$EnvFile = Join-Path $Root '.env'
$Port = 8787
if (Test-Path $EnvFile) {
    foreach ($line in Get-Content $EnvFile) {
        if ($line -match '^\s*AFFETTA_PORT\s*=\s*(\d+)\s*$') { $Port = [int]$Matches[1]; break }
    }
}

$pids = @()
try {
    $pids = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop | Select-Object -ExpandProperty OwningProcess -Unique)
} catch {
    foreach ($line in (& netstat.exe -ano -p tcp 2>$null)) {
        if ($line -match "^\s*TCP\s+\S+:$Port\s+\S+\s+LISTENING\s+(\d+)\s*$") { $pids += [int]$Matches[1] }
    }
}

$healthIsAffetta = $false
try {
    $health = Invoke-RestMethod -UseBasicParsing -Uri "http://127.0.0.1:$Port/api/v1/health" -TimeoutSec 2
    $healthIsAffetta = $health.service -eq 'affetta'
} catch {}

if ($healthIsAffetta) {
    foreach ($processId in @($pids | Select-Object -Unique)) { Stop-Process -Id $processId -Force }
    Write-Host "Affetta arrestato sulla porta $Port."
} elseif (Test-Path $PidFile) {
    $pidValue = (Get-Content $PidFile -Raw).Trim()
    if ($pidValue -match '^\d+$') { Stop-Process -Id ([int]$pidValue) -Force }
    Write-Host 'Processo Affetta registrato arrestato.'
} else {
    Write-Host 'Nessuna istanza Affetta attiva trovata.'
}
Remove-Item -Force $PidFile
