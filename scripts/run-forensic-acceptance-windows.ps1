$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root
$Data = Join-Path $Root 'data'
New-Item -ItemType Directory -Force -Path $Data | Out-Null

function Find-NodePath {
    $runtimeNode = Get-ChildItem -LiteralPath (Join-Path $Root 'runtime') -Filter node.exe -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($runtimeNode) { return $runtimeNode.FullName }
    $systemNode = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($systemNode) { return $systemNode.Source }
    throw 'Node.js non trovato.'
}

function Read-Port {
    $port = 8787
    $envFile = Join-Path $Root '.env'
    if (Test-Path $envFile) {
        $line = Get-Content $envFile | Where-Object { $_ -match '^\s*AFFETTA_PORT\s*=\s*(\d+)' } | Select-Object -First 1
        if ($line -match '(\d+)') { $port = [int]$Matches[1] }
    }
    return $port
}

$Node = Find-NodePath
$Port = Read-Port
$BaseUrl = "http://127.0.0.1:$Port"
$HealthBefore = Invoke-RestMethod -UseBasicParsing -Uri "$BaseUrl/api/v1/health" -TimeoutSec 5
if ($HealthBefore.service -ne 'affetta') { throw 'Il server attivo non è Affetta.' }
$PidBefore = [int]$HealthBefore.process_id
$CrashLog = Join-Path $Data 'process-crash.jsonl'
$CrashLineCountBefore = 0
if (Test-Path $CrashLog) { $CrashLineCountBefore = @(Get-Content $CrashLog).Count }

Write-Host 'FASE 1/4 — Orca/X1C cinque volte sullo stesso server' -ForegroundColor Cyan
$OrcaReport = Join-Path $Data 'acceptance-orca-5x.json'
& $Node (Join-Path $Root 'scripts\live-production-selftest.mjs') --route orca --repeat 5 --report $OrcaReport
if ($LASTEXITCODE -ne 0) { throw "Test Orca 5x fallito. Consulta $OrcaReport" }

Write-Host 'FASE 2/4 — Tre sequenze Prusa -> Marlin -> Orca -> Snapmaker senza riavvio' -ForegroundColor Cyan
$SequenceReport = Join-Path $Data 'acceptance-sequence-3x.json'
& $Node (Join-Path $Root 'scripts\live-production-selftest.mjs') --sequence-repeat 3 --report $SequenceReport
if ($LASTEXITCODE -ne 0) { throw "Tre sequenze complete fallite. Consulta $SequenceReport" }

Write-Host 'FASE 3/4 — Errore motore simulato: HTTP JSON e isolamento del server' -ForegroundColor Cyan
$FailureReport = Join-Path $Data 'acceptance-engine-failure.json'
& $Node (Join-Path $Root 'scripts\failure-isolation-http-selftest.mjs')
if ($LASTEXITCODE -ne 0) { throw "Test isolamento errore motore fallito. Consulta $FailureReport" }

Write-Host 'FASE 4/4 — Verifica finale del processo server reale' -ForegroundColor Cyan
$HealthAfter = Invoke-RestMethod -UseBasicParsing -Uri "$BaseUrl/api/v1/health" -TimeoutSec 5
if ($HealthAfter.service -ne 'affetta') { throw 'Health check finale fallita.' }
if ([int]$HealthAfter.process_id -ne $PidBefore) { throw "Il PID del server è cambiato: prima $PidBefore, dopo $($HealthAfter.process_id)." }

$CrashEvents = @()
if (Test-Path $CrashLog) {
    $AllCrashLines = @(Get-Content $CrashLog)
    if ($AllCrashLines.Count -gt $CrashLineCountBefore) {
        $CrashEvents = @($AllCrashLines | Select-Object -Skip $CrashLineCountBefore | Where-Object { $_ -match 'process_uncaught_exception|process_unhandled_rejection' })
    }
}
if ($CrashEvents.Count -gt 0) { throw "Trovati nuovi eventi process-level nel log $CrashLog" }

Write-Host ''
Write-Host 'COLLAUDO AUTOMATICO DI ACCETTAZIONE SUPERATO.' -ForegroundColor Green
Write-Host "PID server invariato: $PidBefore"
Write-Host "Report Orca 5x: $OrcaReport"
Write-Host "Report sequenze 3x: $SequenceReport"
Write-Host "Report errore motore simulato: $FailureReport"
Write-Host 'Resta da eseguire il controllo manuale browser: creare e scaricare un G-code X1C e uno U1.' -ForegroundColor Yellow
