[CmdletBinding()]
param(
    [string]$RepoPath = "C:\AFFETTA_GITHUB_0412",
    [switch]$NoPause
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RepoPath = (Resolve-Path $RepoPath).Path
Set-Location $RepoPath

$logDir = Join-Path $RepoPath "temp"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$logPath = Join-Path $logDir "octobridge-p4.4-collaudo-$stamp.log"

$env:PYTHONDONTWRITEBYTECODE = "1"
$env:PYTHONPATH = (Join-Path $RepoPath "octobridge-zero")
$failed = $false

function Invoke-Checked {
    param(
        [Parameter(Mandatory=$true)][string]$Label,
        [Parameter(Mandatory=$true)][scriptblock]$Command
    )
    Write-Host ""
    Write-Host "=== $Label ===" -ForegroundColor Cyan
    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$Label fallito con codice $LASTEXITCODE"
    }
}

Start-Transcript -Path $logPath -Force | Out-Null
try {
    if (-not (Test-Path (Join-Path $RepoPath ".git"))) {
        throw "Repository Git non trovato: $RepoPath"
    }

    Invoke-Checked "TEST NODE ADATTATORE OCTOBRIDGE" {
        node --test .\server-lite\test\octobridge-adapter.test.js
    }

    Invoke-Checked "SUITE SERVER LITE" {
        npm run server-lite:test
    }

    Write-Host ""
    Write-Host "=== TEST PYTHON OCTOBRIDGE ===" -ForegroundColor Cyan
    if (Get-Command py -ErrorAction SilentlyContinue) {
        & py -3 -m unittest discover -s .\octobridge-zero\tests -v
    } elseif (Get-Command python -ErrorAction SilentlyContinue) {
        & python -m unittest discover -s .\octobridge-zero\tests -v
    } else {
        throw "Python non trovato (mancano sia py sia python)."
    }
    if ($LASTEXITCODE -ne 0) {
        throw "Test Python falliti con codice $LASTEXITCODE"
    }

    $status = Get-Content .\octobridge-zero\STATUS.json -Raw | ConvertFrom-Json
    if ($status.release_channel -ne "experimental" -or $status.production_ready -ne $false) {
        throw "STATUS.json non conserva experimental / production_ready=false"
    }

    $dirtyCache = @(git status --porcelain | Where-Object { $_ -match '__pycache__|\.pyc$' })
    if ($dirtyCache.Count -gt 0) {
        throw "Il collaudo ha prodotto cache Python non previste:`n$($dirtyCache -join "`n")"
    }

    Write-Host ""
    Write-Host "=== COLLAUDO SOFTWARE P4.4 COMPLETATO ===" -ForegroundColor Green
    Write-Host "experimental / production_ready=false"
    Write-Host "Log salvato in: $logPath"
    Write-Host "Restano obbligatori i collaudi fisici sul Raspberry Pi."
}
catch {
    $failed = $true
    Write-Host ""
    Write-Host "COLLAUDO FALLITO: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Log salvato in: $logPath"
}
finally {
    Stop-Transcript | Out-Null
    if (-not $NoPause) {
        Write-Host ""
        Read-Host "Premi INVIO per chiudere"
    }
}

if ($failed) { exit 1 }
exit 0
