[CmdletBinding()]
param(
    [string]$RepoPath = 'C:\AFFETTA_GITHUB_0412',
    [string]$AffettaRoot = '',
    [string]$BackendUrl = 'http://127.0.0.1:8790',
    [string]$LocalAffettaUrl = 'http://127.0.0.1:8787',
    [string]$LocalApiKey = '',
    [switch]$KeepAffettaRunning
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$ArgumentList,
        [string]$WorkingDirectory = ''
    )
    if ($WorkingDirectory) { Push-Location -LiteralPath $WorkingDirectory }
    try {
        & $FilePath @ArgumentList
        if ($LASTEXITCODE -ne 0) {
            throw "Comando fallito ($LASTEXITCODE): $FilePath $($ArgumentList -join ' ')"
        }
    }
    finally { if ($WorkingDirectory) { Pop-Location } }
}

function Test-JsonEndpoint {
    param([string]$Uri, [hashtable]$Headers = @{})
    try { return Invoke-RestMethod -Uri $Uri -Method Get -Headers $Headers -TimeoutSec 5 }
    catch { return $null }
}

function Wait-Backend {
    param([int]$Seconds = 180)
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        $ready = Test-JsonEndpoint -Uri "$BackendUrl/readyz"
        if ($ready -and $ready.ok -eq $true) { return $ready }
        Start-Sleep -Seconds 3
    }
    throw "Backend non ready su $BackendUrl/readyz entro $Seconds secondi."
}

function Wait-LocalAffetta {
    param([int]$Seconds = 120, [hashtable]$Headers = @{})
    $deadline = (Get-Date).AddSeconds($Seconds)
    $last = ''
    while ((Get-Date) -lt $deadline) {
        try {
            $health = Invoke-RestMethod -Uri "$LocalAffettaUrl/api/v1/health" -Headers $Headers -TimeoutSec 5
            if ($health.success -eq $true) { return $health }
            $last = $health | ConvertTo-Json -Depth 10 -Compress
        }
        catch { $last = $_.Exception.Message }
        Start-Sleep -Seconds 2
    }
    throw "Affetta locale non disponibile entro $Seconds secondi. Ultimo errore: $last"
}

if (-not (Test-Path -LiteralPath $RepoPath -PathType Container)) { throw "Repository non trovato: $RepoPath" }
$BackendDir = Join-Path $RepoPath 'backend'
$AgentDir = Join-Path $RepoPath 'agent'
$BackendEnv = Join-Path $BackendDir '.env'
$LiveScript = Join-Path $BackendDir 'p4-2\live.mjs'
if (-not (Test-Path -LiteralPath $BackendEnv -PathType Leaf)) { throw "backend\.env non trovato: $BackendEnv" }
if (-not (Test-Path -LiteralPath $LiveScript -PathType Leaf)) { throw "P4.2 non applicato: $LiveScript" }

$GitExe = (Get-Command git.exe -ErrorAction Stop).Source
$NodeExe = (Get-Command node.exe -ErrorAction Stop).Source
$NpmExe = (Get-Command npm.cmd -ErrorAction Stop).Source
$DockerExe = (Get-Command docker.exe -ErrorAction Stop).Source

Push-Location -LiteralPath $RepoPath
try {
    if ((& $GitExe branch --show-current).Trim() -ne 'main') { throw 'Il ramo corrente deve essere main.' }
    if (@(& $GitExe status --porcelain).Count -ne 0) { throw 'Working tree non pulito.' }
    $subject = (& $GitExe log -1 --pretty=%s).Trim()
    $requiredMilestone = 'beta: add browser job workflow and enforce free quotas'
    $historySubjects = @(& $GitExe log -20 --pretty=%s)
    if ($historySubjects -notcontains $requiredMilestone) {
        throw "Milestone P4.2 non trovata nella cronologia recente. HEAD corrente: '$subject'. Applicare prima P4.2."
    }
    Write-Host "Milestone P4.2 rilevata nella cronologia. HEAD corrente: $subject" -ForegroundColor Green
}
finally { Pop-Location }

Write-Host '=== AFFETTA P4.2 - BROWSER, JOB, AGENT E DOWNLOAD ===' -ForegroundColor Cyan
Invoke-Checked -FilePath $DockerExe -ArgumentList @('info')

Write-Host 'Build e suite backend P4.2...' -ForegroundColor Cyan
Invoke-Checked -FilePath $NpmExe -ArgumentList @('test') -WorkingDirectory $BackendDir
Write-Host 'Build e suite Agent...' -ForegroundColor Cyan
Invoke-Checked -FilePath $NpmExe -ArgumentList @('run','build') -WorkingDirectory $AgentDir
Invoke-Checked -FilePath $NpmExe -ArgumentList @('test') -WorkingDirectory $AgentDir
Invoke-Checked -FilePath $NpmExe -ArgumentList @('run','test:p3.3') -WorkingDirectory $AgentDir

$localHeaders = @{}
if ($LocalApiKey) { $localHeaders['Authorization'] = "Bearer $LocalApiKey" }
$localHealth = Test-JsonEndpoint -Uri "$LocalAffettaUrl/api/v1/health" -Headers $localHeaders
$startedProcess = $null
if (-not $localHealth -or $localHealth.success -ne $true) {
    if (-not $AffettaRoot) {
        if (Test-Path -LiteralPath 'C:\AFFETTA\package.json') { $AffettaRoot = 'C:\AFFETTA' }
        else { $AffettaRoot = $RepoPath }
    }
    if (-not (Test-Path -LiteralPath (Join-Path $AffettaRoot 'package.json') -PathType Leaf)) {
        throw "Affetta locale non avviato e package.json non trovato in $AffettaRoot"
    }
    $logDir = Join-Path $env:LOCALAPPDATA 'Affetta\p4-2-launcher-logs'
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $stdout = Join-Path $logDir "affetta-$stamp.stdout.log"
    $stderr = Join-Path $logDir "affetta-$stamp.stderr.log"
    Write-Host "Avvio Affetta locale da $AffettaRoot..." -ForegroundColor Yellow
    $startedProcess = Start-Process -FilePath $NpmExe -ArgumentList @('start') -WorkingDirectory $AffettaRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
    $localHealth = Wait-LocalAffetta -Headers $localHeaders
    Write-Host "Affetta locale avviato (PID $($startedProcess.Id))." -ForegroundColor Green
}
else { Write-Host 'Affetta locale era gia attivo.' -ForegroundColor Green }

$quotaVariable = Get-Item Env:AFFETTA_BETA_FREE_DAILY_JOBS -ErrorAction SilentlyContinue
$hadQuotaVariable = $null -ne $quotaVariable
$oldQuotaValue = if ($hadQuotaVariable) { $quotaVariable.Value } else { $null }
$liveSucceeded = $false

try {
    # Il collaudo usa temporaneamente quota 1 per dimostrare realmente il blocco del secondo job.
    $env:AFFETTA_BETA_FREE_DAILY_JOBS = '1'
    Write-Host 'Ricostruzione backend, migrazione 003 e quota di prova atomica...' -ForegroundColor Cyan
    Invoke-Checked -FilePath $DockerExe -ArgumentList @('compose','--project-name','affetta-p3','build','backend-migrate','backend') -WorkingDirectory $BackendDir
    Invoke-Checked -FilePath $DockerExe -ArgumentList @('compose','--project-name','affetta-p3','up','-d','--force-recreate','--remove-orphans') -WorkingDirectory $BackendDir
    try { Wait-Backend | Out-Null }
    catch {
        & $DockerExe compose --project-name affetta-p3 ps
        & $DockerExe compose --project-name affetta-p3 logs --no-color --tail 180 backend-migrate backend postgres redis minio
        throw
    }

    $arguments = @(
        $LiveScript,
        '--repo', $RepoPath,
        '--backend-env', $BackendEnv,
        '--backend-url', $BackendUrl,
        '--local-url', $LocalAffettaUrl,
        '--expected-daily-jobs', '1'
    )
    if ($LocalApiKey) { $arguments += @('--local-api-key', $LocalApiKey) }
    Write-Host 'Esecuzione account beta, upload, quota, Agent, job e download...' -ForegroundColor Cyan
    Invoke-Checked -FilePath $NodeExe -ArgumentList $arguments -WorkingDirectory $RepoPath
    $liveSucceeded = $true
}
finally {
    if ($hadQuotaVariable) { $env:AFFETTA_BETA_FREE_DAILY_JOBS = $oldQuotaValue }
    else { Remove-Item Env:AFFETTA_BETA_FREE_DAILY_JOBS -ErrorAction SilentlyContinue }

    try {
        Write-Host 'Ripristino configurazione Free ordinaria e stack loopback...' -ForegroundColor Cyan
        Invoke-Checked -FilePath $DockerExe -ArgumentList @('compose','--project-name','affetta-p3','up','-d','--force-recreate','backend') -WorkingDirectory $BackendDir
        Wait-Backend | Out-Null
    }
    catch { Write-Warning "Ripristino backend da verificare manualmente: $($_.Exception.Message)" }

    if ($startedProcess -and -not $KeepAffettaRunning) {
        Write-Host "Arresto Affetta locale avviato dal collaudo (PID $($startedProcess.Id))..." -ForegroundColor Yellow
        Stop-Process -Id $startedProcess.Id -Force -ErrorAction SilentlyContinue
    }
}

if ($liveSucceeded) {
    Write-Host ''
    Write-Host '=== COLLAUDO LIVE BETA P4.2 SUPERATO ===' -ForegroundColor Green
    Write-Host 'Stack Docker lasciato attivo su loopback con i limiti Free ordinari.' -ForegroundColor Green
    Write-Host "Beta locale: $BackendUrl/beta/" -ForegroundColor Green
}
