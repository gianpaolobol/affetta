[CmdletBinding()]
param(
    [string]$RepoPath = 'C:\AFFETTA_GITHUB_0412',
    [string]$BackendUrl = 'http://127.0.0.1:8790'
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

if (-not (Test-Path -LiteralPath $RepoPath -PathType Container)) { throw "Repository non trovato: $RepoPath" }
$BackendDir = Join-Path $RepoPath 'backend'
$EnvPath = Join-Path $BackendDir '.env'
if (-not (Test-Path -LiteralPath $EnvPath -PathType Leaf)) { throw "Manca $EnvPath. Conservare il .env creato in P3." }

$GitExe = (Get-Command git.exe -ErrorAction Stop).Source
$NodeExe = (Get-Command node.exe -ErrorAction Stop).Source
$NpmExe = (Get-Command npm.cmd -ErrorAction Stop).Source
$DockerExe = (Get-Command docker.exe -ErrorAction Stop).Source

Push-Location -LiteralPath $RepoPath
try {
    if ((& $GitExe branch --show-current).Trim() -ne 'main') { throw 'Il ramo corrente deve essere main.' }
    if (@(& $GitExe status --porcelain).Count -ne 0) { throw 'Working tree non pulito.' }
    $subject = (& $GitExe log -1 --pretty=%s).Trim()
    if ($subject -ne 'beta: add free web identity and account foundation') {
        throw "HEAD inatteso: '$subject'. Applicare prima P4.1."
    }
}
finally { Pop-Location }

Write-Host '=== AFFETTA P4.1 - BETA WEB GRATUITA ===' -ForegroundColor Cyan
Invoke-Checked -FilePath $DockerExe -ArgumentList @('info')

Write-Host 'Build e test backend P4.1...' -ForegroundColor Cyan
Invoke-Checked -FilePath $NpmExe -ArgumentList @('test') -WorkingDirectory $BackendDir

Write-Host 'Ricostruzione backend e applicazione migrazione 002...' -ForegroundColor Cyan
Invoke-Checked -FilePath $DockerExe -ArgumentList @('compose','--project-name','affetta-p3','build','backend-migrate','backend') -WorkingDirectory $BackendDir
Invoke-Checked -FilePath $DockerExe -ArgumentList @('compose','--project-name','affetta-p3','up','-d','--force-recreate','--remove-orphans') -WorkingDirectory $BackendDir

$ready = $false
for ($attempt = 1; $attempt -le 40; $attempt++) {
    try {
        $response = Invoke-RestMethod -Uri "$BackendUrl/readyz" -Method Get -TimeoutSec 5
        if ($response.ok -eq $true) { $ready = $true; break }
    }
    catch { Start-Sleep -Seconds 2 }
}
if (-not $ready) {
    & $DockerExe compose --project-name affetta-p3 ps
    & $DockerExe compose --project-name affetta-p3 logs --no-color --tail 150 backend-migrate backend postgres
    throw 'Backend P4.1 non pronto.'
}

$ReportDir = Join-Path $BackendDir 'p4-1\reports'
Invoke-Checked -FilePath $NodeExe -ArgumentList @(
    (Join-Path $BackendDir 'p4-1\live.mjs'),
    '--backend-url', $BackendUrl,
    '--report-dir', $ReportDir
) -WorkingDirectory $RepoPath

Write-Host ''
Write-Host 'Stack Docker lasciato attivo su loopback.' -ForegroundColor Yellow
Write-Host "Beta locale: $BackendUrl/beta/" -ForegroundColor Green
