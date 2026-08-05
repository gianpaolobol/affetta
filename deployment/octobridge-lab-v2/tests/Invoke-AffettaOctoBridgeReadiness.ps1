[CmdletBinding()]
param(
    [string]$RepoRoot = 'C:\AFFETTA_GITHUB_0412',
    [string]$RuntimeRoot = 'C:\AFFETTA_RUNTIME',
    [switch]$SkipFullAffettaTests
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# Windows PowerShell 5.1 può trasformare lo stderr dei programmi nativi
# in NativeCommandError quando viene incanalato in Tee-Object. I test Python
# unittest scrivono normalmente il progresso su stderr anche con exit code 0.
# Questa suite usa quindi Start-Process e file stdout/stderr separati.
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $Utf8NoBom
$OutputEncoding = $Utf8NoBom
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'

$PackageRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$ReportDirectory = Join-Path $RuntimeRoot 'reports\octobridge-readiness'
New-Item -ItemType Directory -Force -Path $ReportDirectory | Out-Null
$Timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$LogPath = Join-Path $ReportDirectory "P4.4.2-readiness-$Timestamp.log"
$JsonPath = Join-Path $ReportDirectory "P4.4.2-readiness-$Timestamp.json"
$MarkdownPath = Join-Path $ReportDirectory "P4.4.2-readiness-$Timestamp.md"
$CaptureDirectory = Join-Path $ReportDirectory "capture-$Timestamp"
New-Item -ItemType Directory -Force -Path $CaptureDirectory | Out-Null

function Resolve-NativeApplication {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Names
    )

    foreach ($Name in $Names) {
        $Command = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if ($null -ne $Command) {
            return $Command.Source
        }
    }

    throw "Programma nativo non trovato: $($Names -join ', ')"
}

function Write-LogLines {
    param(
        [string[]]$Lines,
        [ConsoleColor]$Color = [ConsoleColor]::Gray
    )

    foreach ($Line in @($Lines)) {
        if ($null -eq $Line) { continue }
        Add-Content -LiteralPath $LogPath -Value ([string]$Line) -Encoding UTF8
        Write-Host ([string]$Line) -ForegroundColor $Color
    }
}

if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot '.git') -PathType Container)) {
    throw "Repository Affetta non trovato: $RepoRoot"
}
if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot 'octobridge-zero\affetta_octobridge') -PathType Container)) {
    throw 'Modulo octobridge-zero non trovato nel repository.'
}

$Python = Resolve-NativeApplication -Names @('python.exe', 'python3.exe')
$Node = Resolve-NativeApplication -Names @('node.exe')
$Npm = Resolve-NativeApplication -Names @('npm.cmd', 'npm.exe')
$Git = Resolve-NativeApplication -Names @('git.exe')

$Results = [System.Collections.Generic.List[object]]::new()

function Invoke-ReadinessStep {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [string]$WorkingDirectory = $RepoRoot
    )

    $Started = Get-Date
    $SafeName = ($Name -replace '[^A-Za-z0-9._-]+', '-').Trim('-')
    $StdOutPath = Join-Path $CaptureDirectory "$SafeName.stdout.log"
    $StdErrPath = Join-Path $CaptureDirectory "$SafeName.stderr.log"

    Add-Content -LiteralPath $LogPath -Value "`n===== $Name =====" -Encoding UTF8
    Write-Host "`n=== $Name ==="

    $Process = Start-Process `
        -FilePath $FilePath `
        -ArgumentList $Arguments `
        -WorkingDirectory $WorkingDirectory `
        -RedirectStandardOutput $StdOutPath `
        -RedirectStandardError $StdErrPath `
        -NoNewWindow `
        -Wait `
        -PassThru

    $StdOut = @()
    $StdErr = @()

    if (Test-Path -LiteralPath $StdOutPath -PathType Leaf) {
        $StdOut = @(Get-Content -LiteralPath $StdOutPath -Encoding UTF8)
    }
    if (Test-Path -LiteralPath $StdErrPath -PathType Leaf) {
        $StdErr = @(Get-Content -LiteralPath $StdErrPath -Encoding UTF8)
    }

    Write-LogLines -Lines $StdOut
    if ($StdErr.Count -gt 0) {
        # stderr è diagnostica, non prova di fallimento: decide ExitCode.
        Write-LogLines -Lines $StdErr -Color DarkYellow
    }

    $ExitCode = [int]$Process.ExitCode
    $Duration = [math]::Round(((Get-Date) - $Started).TotalSeconds, 2)
    $Status = if ($ExitCode -eq 0) { 'PASS' } else { 'FAIL' }

    $Results.Add([pscustomobject]@{
        name = $Name
        status = $Status
        exit_code = $ExitCode
        duration_seconds = $Duration
        stdout_file = $StdOutPath
        stderr_file = $StdErrPath
    })

    if ($ExitCode -ne 0) {
        throw "Step fallito: $Name (exit $ExitCode). Log: $LogPath"
    }
}

$Branch = (& $Git -C $RepoRoot branch --show-current).Trim()
$Commit = (& $Git -C $RepoRoot rev-parse HEAD).Trim()
$StatusBefore = @(& $Git -C $RepoRoot status --short)
if ($StatusBefore.Count -gt 0) {
    Write-Warning 'Il working tree contiene modifiche. I test proseguono senza modificarle.'
}

$Overall = 'FAIL'

try {
    Invoke-ReadinessStep -Name 'Validazione package laboratorio' -FilePath $Python -Arguments @(
        (Join-Path $PackageRoot 'tests\validate_lab_package.py'), '--root', $PackageRoot
    )
    Invoke-ReadinessStep -Name 'Unit test Fake OctoPrint' -FilePath $Python -Arguments @(
        (Join-Path $PackageRoot 'tests\test_fake_octoprint.py')
    )
    Invoke-ReadinessStep -Name 'Compilazione Python OctoBridge' -FilePath $Python -Arguments @(
        '-m', 'compileall', '-q', (Join-Path $RepoRoot 'octobridge-zero\affetta_octobridge'),
        (Join-Path $PackageRoot 'lib'), (Join-Path $PackageRoot 'simulator'), (Join-Path $PackageRoot 'tests')
    )
    $OctoBridgeRoot = Join-Path $RepoRoot 'octobridge-zero'
    Invoke-ReadinessStep -Name 'Unit test Python OctoBridge' -FilePath $Python -Arguments @(
        '-m', 'unittest', 'discover', '-s', 'tests', '-t', '.', '-v'
    ) -WorkingDirectory $OctoBridgeRoot
    Invoke-ReadinessStep -Name 'Test Node Server Lite' -FilePath $Npm -Arguments @(
        'run', 'server-lite:test'
    )
    Invoke-ReadinessStep -Name 'E2E adapter Server Lite OctoBridge' -FilePath $Node -Arguments @(
        (Join-Path $PackageRoot 'tests\e2e_server_lite_adapter.mjs'), '--repo-root', $RepoRoot
    )
    Invoke-ReadinessStep -Name 'E2E OctoBridge con Fake OctoPrint' -FilePath $Python -Arguments @(
        (Join-Path $PackageRoot 'tests\e2e_octobridge_readiness.py'), '--repo-root', $RepoRoot
    )
    if (-not $SkipFullAffettaTests) {
        Invoke-ReadinessStep -Name 'Test completi Affetta' -FilePath $Npm -Arguments @('test')
    }
    $Overall = 'PASS'
}
catch {
    $Overall = 'FAIL'
    Add-Content -LiteralPath $LogPath -Value "`nERRORE FINALE: $($_.Exception.Message)" -Encoding UTF8
    Write-Host $_.Exception.Message -ForegroundColor Red
}
finally {
    $Finished = Get-Date
    $Report = [ordered]@{
        schema_version = 'affetta.octobridge-readiness-report.v2'
        generated_at = $Finished.ToString('o')
        repo_root = $RepoRoot
        branch = $Branch
        commit = $Commit
        working_tree_clean_at_start = ($StatusBefore.Count -eq 0)
        overall = $Overall
        software_ready = ($Overall -eq 'PASS')
        hardware_validation_pending = $true
        production_ready = $false
        results = @($Results)
        log_file = $LogPath
        capture_directory = $CaptureDirectory
    }
    [System.IO.File]::WriteAllText($JsonPath, ($Report | ConvertTo-Json -Depth 20), $Utf8NoBom)

    $Lines = [System.Collections.Generic.List[string]]::new()
    $Lines.Add('# Affetta OctoBridge — Readiness report P4.4.2')
    $Lines.Add('')
    $Lines.Add("- Data: $($Finished.ToString('yyyy-MM-dd HH:mm:ss'))")
    $Lines.Add("- Branch: ``$Branch``")
    $Lines.Add("- Commit: ``$Commit``")
    $Lines.Add("- Esito software: **$Overall**")
    $Lines.Add('- Collaudo hardware Raspberry/SD/stampante: **PENDENTE**')
    $Lines.Add('- `production_ready`: **false**')
    $Lines.Add('')
    $Lines.Add('| Test | Esito | Exit | Secondi |')
    $Lines.Add('|---|---:|---:|---:|')
    foreach ($Result in $Results) {
        $Lines.Add("| $($Result.name) | $($Result.status) | $($Result.exit_code) | $($Result.duration_seconds) |")
    }
    $Lines.Add('')
    $Lines.Add("Log completo: ``$LogPath``")
    $Lines.Add("Output separati: ``$CaptureDirectory``")
    [System.IO.File]::WriteAllLines($MarkdownPath, $Lines, $Utf8NoBom)

    Write-Host ''
    Write-Host "Report JSON: $JsonPath"
    Write-Host "Report MD:   $MarkdownPath"
    Write-Host "Log:         $LogPath"
    Write-Host "Capture:     $CaptureDirectory"
}

if ($Overall -ne 'PASS') { exit 1 }
exit 0
