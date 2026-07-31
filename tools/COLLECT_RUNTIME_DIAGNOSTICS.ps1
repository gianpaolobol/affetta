param(
    [string]$Root = 'C:\AFFETTA'
)

$ErrorActionPreference = 'Continue'
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$desktop = [Environment]::GetFolderPath('Desktop')
$out = Join-Path $desktop "AFFETTA_DIAGNOSTICA_$timestamp"
New-Item -ItemType Directory -Path $out -Force | Out-Null

function Copy-IfExists([string]$Source, [string]$DestinationName = '') {
    if (Test-Path -LiteralPath $Source) {
        $dest = if ($DestinationName) { Join-Path $out $DestinationName } else { Join-Path $out (Split-Path $Source -Leaf) }
        $parent = Split-Path $dest -Parent
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
        Copy-Item -LiteralPath $Source -Destination $dest -Force -Recurse
    }
}

function Save-Text([string]$Name, [scriptblock]$Action) {
    try { & $Action | Out-String -Width 500 | Set-Content -LiteralPath (Join-Path $out $Name) -Encoding UTF8 }
    catch { $_ | Out-String | Set-Content -LiteralPath (Join-Path $out $Name) -Encoding UTF8 }
}

# Runtime logs and reports
$runtimeFiles = @(
    'data\startup.log',
    'data\server.stderr.log',
    'data\server.stdout.log',
    'data\live-production-selftest.json',
    'data\engine-selftest.json',
    'data\profile-selftest.json',
    'data\affetta.pid',
    'data\runtime-diagnostics.jsonl',
    'data\process-crash.jsonl',
    'data\acceptance-orca-5x.json',
    'data\acceptance-sequence-3x.json',
    'data\engine-debug',
    'data\engine-process',
    'VERSION',
    'package.json',
    'config\app.json',
    'config\printers.json'
)
foreach ($relative in $runtimeFiles) { Copy-IfExists (Join-Path $Root $relative) $relative }

# Relevant source files
$sourceFiles = @(
    'server.js',
    'scripts\live-production-selftest.mjs',
    'scripts\start-windows.ps1',
    'src\slice-service.js',
    'src\providers\command-slicer.js',
    'src\providers\engine-utils.js',
    'src\providers\engine-registry.js',
    'src\providers\engines\orca.js',
    'src\providers\engines\prusa.js',
    'src\gcode-validator.js',
    'src\job-store.js',
    'src\store.js',
    'src\runtime-diagnostics.js',
    'scripts\run-forensic-acceptance-windows.ps1'
)
foreach ($relative in $sourceFiles) { Copy-IfExists (Join-Path $Root $relative) (Join-Path 'source' $relative) }

# Sanitized .env
$envPath = Join-Path $Root '.env'
if (Test-Path $envPath) {
    $sanitized = Get-Content -LiteralPath $envPath | ForEach-Object {
        if ($_ -match '^\s*([^#=]*(?:TOKEN|SECRET|PASSWORD|API_KEY|SMTP_PASS)[^=]*)=') { "$($Matches[1])=<REDACTED>" } else { $_ }
    }
    $sanitized | Set-Content -LiteralPath (Join-Path $out 'env-sanitized.txt') -Encoding UTF8
}

Save-Text 'system-info.txt' {
    "Timestamp: $(Get-Date -Format o)"
    "Windows: $([Environment]::OSVersion.VersionString)"
    "PowerShell: $($PSVersionTable.PSVersion)"
    "Root exists: $(Test-Path $Root)"
    "Node: $(& node.exe --version 2>&1)"
    "Working root: $Root"
}

$port = 8787
if (Test-Path $envPath) {
    $line = Get-Content $envPath | Where-Object { $_ -match '^\s*AFFETTA_PORT\s*=\s*(\d+)' } | Select-Object -First 1
    if ($line -match '(\d+)') { $port = [int]$Matches[1] }
}

Save-Text 'network-port.txt' {
    "Port: $port"
    try { Get-NetTCPConnection -LocalPort $port -ErrorAction Stop | Format-List * } catch { & netstat.exe -ano -p tcp | Select-String ":$port" }
}

Save-Text 'processes.txt' {
    Get-CimInstance Win32_Process | Where-Object {
        $_.Name -match '^(node|orca-slicer|prusa-slicer-console|snapmaker-orca)\.exe$' -or $_.CommandLine -match 'AFFETTA|bootstrap\.js|orca-slicer'
    } | Select-Object ProcessId, ParentProcessId, Name, ExecutablePath, CommandLine | Format-List
}


Save-Text 'pid-status.txt' {
    $pidFile = Join-Path $Root 'data\affetta.pid'
    if (Test-Path $pidFile) {
        $serverPid = [int](Get-Content $pidFile -Raw).Trim()
        "PID file: $serverPid"
        Get-Process -Id $serverPid -ErrorAction SilentlyContinue | Select-Object Id, ProcessName, StartTime, CPU, WorkingSet64, Path | Format-List
    } else {
        'PID file assente.'
    }
}

Save-Text 'node-runtime-details.txt' {
    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($node) {
        "Node path: $($node.Source)"
        "Node version: $(& $node.Source --version 2>&1)"
        "Node architecture: $(& $node.Source -p 'process.arch' 2>&1)"
        "Node execPath: $(& $node.Source -p 'process.execPath' 2>&1)"
    } else {
        'node.exe non trovato nel PATH.'
    }
}

Save-Text 'health.txt' {
    try { Invoke-RestMethod -UseBasicParsing -Uri "http://127.0.0.1:$port/api/v1/health" -TimeoutSec 3 | ConvertTo-Json -Depth 10 }
    catch { $_ | Format-List * -Force }
}

Save-Text 'engine-files.txt' {
    Get-ChildItem -Path (Join-Path $Root 'runtime\engines') -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '(prusa-slicer-console|orca-slicer|CuraEngine|snapmaker-orca)\.exe$' } |
        Select-Object FullName, Length, LastWriteTime | Format-Table -AutoSize
}

Save-Text 'recent-application-errors.txt' {
    $start = (Get-Date).AddHours(-4)
    Get-WinEvent -FilterHashtable @{ LogName='Application'; StartTime=$start; Level=2 } -ErrorAction SilentlyContinue |
        Where-Object { $_.Message -match 'node\.exe|orca-slicer|Affetta|VCRUNTIME|ucrtbase|KERNELBASE' } |
        Select-Object -First 50 TimeCreated, ProviderName, Id, LevelDisplayName, Message | Format-List
}

# Hash relevant code
Save-Text 'sha256.txt' {
    Get-ChildItem -Path (Join-Path $out 'source') -Recurse -File -ErrorAction SilentlyContinue |
        Get-FileHash -Algorithm SHA256 | Select-Object Path, Hash | Format-Table -AutoSize
}

$zip = "$out.zip"
Compress-Archive -Path (Join-Path $out '*') -DestinationPath $zip -Force
Write-Host ''
Write-Host 'Raccolta completata:' -ForegroundColor Green
Write-Host $zip
Write-Host 'Carica questo ZIP insieme al pacchetto handoff.'
