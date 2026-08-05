[CmdletBinding()]
param(
    [string]$RepoRoot = 'C:\AFFETTA_GITHUB_0412',
    [string]$RuntimeRoot = 'C:\AFFETTA_RUNTIME',
    [switch]$KeepTemporary
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$PackageRoot = Join-Path $RepoRoot 'deployment\octobridge-lab-v2'
$ReportRoot = Join-Path $RuntimeRoot ('reports\octobridge-fleet-readiness\' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Force -Path $ReportRoot | Out-Null
function Resolve-NativeApplication([string[]]$Names) {
    foreach ($Name in $Names) {
        $Candidates = @(Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue)
        $Real = @($Candidates | Where-Object { $_.Source -and $_.Source -notlike '*\WindowsApps\python.exe' } | Select-Object -First 1)
        if ($Real.Count -gt 0) { return [string]$Real[0].Source }
        if ($Candidates.Count -gt 0) { return [string]$Candidates[0].Source }
    }
    throw "Programma non trovato: $($Names -join ', ')"
}
function Invoke-Step([string]$Name, [string]$FilePath, [string[]]$Arguments, [string]$WorkingDirectory) {
    Write-Host "`n=== $Name ==="
    $Safe = ($Name -replace '[^A-Za-z0-9._-]+','-').Trim('-')
    $Out = Join-Path $ReportRoot ($Safe + '.stdout.log')
    $Err = Join-Path $ReportRoot ($Safe + '.stderr.log')
    $Process = Start-Process -FilePath $FilePath -ArgumentList $Arguments -WorkingDirectory $WorkingDirectory -RedirectStandardOutput $Out -RedirectStandardError $Err -NoNewWindow -Wait -PassThru
    if (Test-Path $Out) { Get-Content $Out -Encoding UTF8 | ForEach-Object { Write-Host $_ } }
    if (Test-Path $Err) { Get-Content $Err -Encoding UTF8 | ForEach-Object { Write-Host $_ -ForegroundColor DarkYellow } }
    if ([int]$Process.ExitCode -ne 0) { throw "$Name fallito: exit $($Process.ExitCode). Report: $ReportRoot" }
}
$Python = Resolve-NativeApplication @('python.exe','python3.exe','python3','python')
$Node = Resolve-NativeApplication @('node.exe','node')
Write-Host "Python: $Python"
Write-Host "Node:   $Node"
Invoke-Step 'Validazione P4.4.3' $Python @((Join-Path $PackageRoot 'tests\validate_fleet_readiness.py'), $PackageRoot) $RepoRoot
Invoke-Step 'Test pre-provisioning' $Python @((Join-Path $PackageRoot 'tests\test_fleet_provisioning.py')) $RepoRoot
$Arguments = @((Join-Path $PackageRoot 'tests\e2e_fleet_readiness.py'), '--repo-root', $RepoRoot, '--report-directory', $ReportRoot)
if ($KeepTemporary) { $Arguments += '--keep-temp' }
Invoke-Step 'E2E flotta 12 nodi' $Python $Arguments $RepoRoot
Write-Host ''
Write-Host '[OK] P4.4.3 Fleet Readiness PASS.' -ForegroundColor Green
Write-Host 'fleet_software_ready=true'
Write-Host 'hardware_validation_pending=true'
Write-Host 'production_ready=false'
Write-Host "Report: $ReportRoot"
