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
    try {
        return Invoke-RestMethod -Uri $Uri -Method Get -Headers $Headers -TimeoutSec 5
    }
    catch { return $null }
}

function Wait-LocalAffetta {
    param([int]$Seconds = 90, [hashtable]$Headers = @{})
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
$AgentDir = Join-Path $RepoPath 'agent'
$BackendEnv = Join-Path $RepoPath 'backend\.env'
$LiveScript = Join-Path $AgentDir 'p3-3\live.mjs'
if (-not (Test-Path -LiteralPath $BackendEnv -PathType Leaf)) { throw "backend\.env non trovato: $BackendEnv" }
if (-not (Test-Path -LiteralPath $LiveScript -PathType Leaf)) { throw "P3.3 non applicato: $LiveScript" }

$NodeExe = (Get-Command node.exe -ErrorAction Stop).Source
$NpmExe = (Get-Command npm.cmd -ErrorAction Stop).Source
$DockerExe = (Get-Command docker.exe -ErrorAction Stop).Source

Write-Host '=== AFFETTA P3.3 - COLLEGAMENTO CONTROLLATO AGENT ===' -ForegroundColor Cyan
Invoke-Checked -FilePath $DockerExe -ArgumentList @('info')

$BackendDir = Join-Path $RepoPath 'backend'
Write-Host 'Aggiornamento immagine backend con i contratti P3.3...' -ForegroundColor Cyan
Invoke-Checked -FilePath $DockerExe -ArgumentList @('compose','--project-name','affetta-p3','build','backend-migrate','backend') -WorkingDirectory $BackendDir
Invoke-Checked -FilePath $DockerExe -ArgumentList @('compose','--project-name','affetta-p3','up','-d','--remove-orphans','--force-recreate') -WorkingDirectory $BackendDir

$ready = $null
$deadline = (Get-Date).AddSeconds(180)
while ((Get-Date) -lt $deadline) {
    $ready = Test-JsonEndpoint -Uri "$BackendUrl/readyz"
    if ($ready -and $ready.ok -eq $true) { break }
    Start-Sleep -Seconds 3
}
if (-not $ready -or $ready.ok -ne $true) {
    & $DockerExe compose --project-name affetta-p3 logs --no-color --tail 150 backend backend-migrate
    throw "Backend non ready su $BackendUrl/readyz"
}

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
    $logDir = Join-Path $env:LOCALAPPDATA 'Affetta\p3-3-launcher-logs'
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $stdout = Join-Path $logDir "affetta-$stamp.stdout.log"
    $stderr = Join-Path $logDir "affetta-$stamp.stderr.log"
    Write-Host "Avvio Affetta locale da $AffettaRoot..." -ForegroundColor Yellow
    $startedProcess = Start-Process -FilePath $NpmExe -ArgumentList @('start') -WorkingDirectory $AffettaRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
    $localHealth = Wait-LocalAffetta -Seconds 120 -Headers $localHeaders
    Write-Host "Affetta locale avviato (PID $($startedProcess.Id))." -ForegroundColor Green
}
else {
    Write-Host 'Affetta locale era gia attivo.' -ForegroundColor Green
}

try {
    Write-Host 'Installazione/verifica dipendenze Agent...' -ForegroundColor Cyan
    Invoke-Checked -FilePath $NpmExe -ArgumentList @('install','--package-lock=false','--audit=false','--fund=false') -WorkingDirectory $AgentDir
    Write-Host 'Build TypeScript rigorosa Agent...' -ForegroundColor Cyan
    Invoke-Checked -FilePath $NpmExe -ArgumentList @('run','build') -WorkingDirectory $AgentDir
    Write-Host 'Test P3.3 locali...' -ForegroundColor Cyan
    Invoke-Checked -FilePath $NpmExe -ArgumentList @('run','test:p3.3') -WorkingDirectory $AgentDir

    $arguments = @(
        $LiveScript,
        '--repo', $RepoPath,
        '--backend-env', $BackendEnv,
        '--backend-url', $BackendUrl,
        '--local-url', $LocalAffettaUrl
    )
    if ($LocalApiKey) { $arguments += @('--local-api-key', $LocalApiKey) }
    Write-Host 'Esecuzione pairing, job sintetico, restart e revoca...' -ForegroundColor Cyan
    Invoke-Checked -FilePath $NodeExe -ArgumentList $arguments -WorkingDirectory $RepoPath
}
finally {
    if ($startedProcess -and -not $KeepAffettaRunning) {
        Write-Host "Arresto Affetta locale avviato dal collaudo (PID $($startedProcess.Id))..." -ForegroundColor Yellow
        Stop-Process -Id $startedProcess.Id -Force -ErrorAction SilentlyContinue
    }
}
