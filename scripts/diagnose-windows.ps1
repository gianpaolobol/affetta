$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root
Write-Host 'DIAGNOSTICA AFFETTA' -ForegroundColor Cyan
Write-Host "Cartella: $Root"
Write-Host "PowerShell: $($PSVersionTable.PSVersion)"

$envFile = Join-Path $Root '.env'
$port = 8787
if (Test-Path $envFile) {
    Write-Host '.env: presente'
    foreach ($line in Get-Content $envFile) {
        if ($line -match '^\s*AFFETTA_PORT\s*=\s*(\d+)\s*$') { $port = [int]$Matches[1] }
    }
} else {
    Write-Host '.env: assente (verrà creato al primo avvio)'
}

$portable = Get-ChildItem (Join-Path $Root 'runtime') -Filter node.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
$system = Get-Command node.exe -ErrorAction SilentlyContinue
if ($portable) { Write-Host "Node portatile: $($portable.FullName)" }
elseif ($system) { Write-Host "Node di sistema: $($system.Source)" }
else { Write-Host 'Node: non presente; verrà scaricato automaticamente al primo avvio.' }

$base = "http://127.0.0.1:$port"
try {
    $health = Invoke-RestMethod -UseBasicParsing -Uri "$base/api/v1/health" -TimeoutSec 2
    Write-Host "Server: ATTIVO — versione $($health.version)" -ForegroundColor Green
} catch {
    Write-Host "Server: non raggiungibile su $base" -ForegroundColor Yellow
}

foreach ($name in @('startup.log','server.stdout.log','server.stderr.log')) {
    $path = Join-Path $Root "data\$name"
    if (Test-Path $path) {
        Write-Host "`n--- $name (ultime righe) ---"
        Get-Content $path -Tail 20
    }
}
