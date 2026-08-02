param(
    [switch]$ForceRestart,
    [switch]$RunLiveSelfTest
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$DataDir = Join-Path $Root 'data'
$RuntimeDir = Join-Path $Root 'runtime'
$VersionFile = Join-Path $Root 'VERSION'
$ExpectedVersion = if (Test-Path $VersionFile) { (Get-Content $VersionFile -Raw).Trim() } else { '0.5.1' }
$NodeVersion = '24.18.1'
$NodeFolder = "node-v$NodeVersion-win-x64"
$NodeHome = Join-Path $RuntimeDir $NodeFolder
$PortableNode = Join-Path $NodeHome 'node.exe'
$NodeArchive = Join-Path $RuntimeDir "$NodeFolder.zip"
$NodeUrl = "https://nodejs.org/download/release/v$NodeVersion/$NodeFolder.zip"
$NodeSha256 = 'ec56b84a7551893ab2324ebdfdc4ab974a63b4781162600b68a1293cc3e53765'
$StdoutLog = Join-Path $DataDir 'server.stdout.log'
$StderrLog = Join-Path $DataDir 'server.stderr.log'
$StartupLog = Join-Path $DataDir 'startup.log'
$PidFile = Join-Path $DataDir 'affetta.pid'
$EnvFile = Join-Path $Root '.env'

New-Item -ItemType Directory -Force -Path $DataDir, $RuntimeDir | Out-Null

$Process = $null
$ServerStarted = $false
$BaseUrl = $null

function Write-StartupLog([string]$Message) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message"
    Add-Content -Path $StartupLog -Value $line -Encoding UTF8
    Write-Host $Message
}

function Get-NodeMajor([string]$NodePath) {
    try {
        $version = (& $NodePath --version 2>$null).Trim()
        if ($version -match '^v(\d+)\.') { return [int]$Matches[1] }
    } catch {}
    return 0
}

function Ensure-Node {
    if (Test-Path $PortableNode) {
        if ((Get-NodeMajor $PortableNode) -ge 20) {
            Write-StartupLog "Runtime Node portatile trovato: $(& $PortableNode --version)"
            return $PortableNode
        }
        Remove-Item -Recurse -Force $NodeHome
    }

    $systemNode = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($systemNode) {
        $systemNodePath = $systemNode.Source
        if ((Get-NodeMajor $systemNodePath) -ge 20) {
            Write-StartupLog "Uso Node installato nel sistema: $(& $systemNodePath --version)"
            return $systemNodePath
        }
    }

    Write-StartupLog "Node.js non trovato. Scarico il runtime portatile ufficiale v$NodeVersion..."
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    if (Test-Path $NodeArchive) { Remove-Item -Force $NodeArchive }
    Invoke-WebRequest -UseBasicParsing -Uri $NodeUrl -OutFile $NodeArchive

    $actualHash = (Get-FileHash -Algorithm SHA256 -Path $NodeArchive).Hash.ToLowerInvariant()
    if ($actualHash -ne $NodeSha256) {
        Remove-Item -Force $NodeArchive
        throw 'Controllo di sicurezza fallito: checksum del runtime Node non valido.'
    }

    Expand-Archive -Path $NodeArchive -DestinationPath $RuntimeDir -Force
    Remove-Item -Force $NodeArchive
    if (-not (Test-Path $PortableNode)) {
        throw 'Il runtime Node è stato scaricato ma node.exe non è stato trovato.'
    }
    Write-StartupLog "Runtime Node portatile installato: $(& $PortableNode --version)"
    return $PortableNode
}

function Get-InstanceId([string]$Value) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($Value.ToLowerInvariant())
        $hash = $sha.ComputeHash($bytes)
        return (([System.BitConverter]::ToString($hash)).Replace('-', '').ToLowerInvariant()).Substring(0, 16)
    } finally {
        $sha.Dispose()
    }
}

function Read-Port {
    $port = 8787
    if (Test-Path $EnvFile) {
        foreach ($line in Get-Content $EnvFile) {
            if ($line -match '^\s*AFFETTA_PORT\s*=\s*(\d+)\s*$') {
                $port = [int]$Matches[1]
                break
            }
        }
    }
    return $port
}

function Get-ObjectProperty($Object, [string]$Name) {
    if ($null -eq $Object) { return $null }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return $property.Value
}

function Test-AffettaHealth([string]$BaseUrl) {
    try {
        return Invoke-RestMethod -UseBasicParsing -Uri "$BaseUrl/api/v1/health" -TimeoutSec 2
    } catch {
        return $null
    }
}

function Get-ListenerPids([int]$Port) {
    $result = @()
    try {
        $result = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop | Select-Object -ExpandProperty OwningProcess -Unique)
    } catch {
        try {
            foreach ($line in (& netstat.exe -ano -p tcp 2>$null)) {
                if ($line -match "^\s*TCP\s+\S+:$Port\s+\S+\s+LISTENING\s+(\d+)\s*$") {
                    $result += [int]$Matches[1]
                }
            }
        } catch {}
    }
    return @($result | Where-Object { $_ -and $_ -gt 0 } | Select-Object -Unique)
}

function Wait-PortFree([int]$Port, [int]$TimeoutMs = 8000) {
    # @() forza sempre un array: con StrictMode un singolo PID non espone .Count.
    $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
    do {
        if (@(Get-ListenerPids $Port).Count -eq 0) { return $true }
        Start-Sleep -Milliseconds 200
    } while ([DateTime]::UtcNow -lt $deadline)
    return $false
}

function Stop-ExistingAffetta([int]$Port, [string]$BaseUrl) {
    $pids = @(Get-ListenerPids $Port)
    if ($pids.Count -eq 0) {
        if (Test-Path $PidFile) { Remove-Item -Force $PidFile -ErrorAction SilentlyContinue }
        return
    }

    $health = Test-AffettaHealth $BaseUrl
    if (-not $health -or $health.service -ne 'affetta') {
        throw "La porta $Port è occupata da un'altra applicazione. Chiudila o modifica AFFETTA_PORT nel file .env."
    }

    Write-StartupLog "Arresto la precedente istanza Affetta sulla porta $Port (PID: $($pids -join ', '))..."
    foreach ($processId in $pids) {
        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }
    if (-not (Wait-PortFree $Port)) {
        throw "La precedente istanza Affetta non ha liberato la porta $Port."
    }
    Remove-Item -Force $PidFile -ErrorAction SilentlyContinue
}

function Find-EngineExecutable([string]$SearchRoot, [string[]]$Names) {
    if (-not (Test-Path $SearchRoot)) { return $null }
    foreach ($name in $Names) {
        $direct = Join-Path $SearchRoot $name
        if (Test-Path $direct) { return (Resolve-Path $direct).Path }
    }
    $found = Get-ChildItem -Path $SearchRoot -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $Names -contains $_.Name } |
        Select-Object -First 1
    if ($found) { return $found.FullName }
    return $null
}

function Remove-DotEnvKeys([string[]]$Names) {
    if (-not (Test-Path $EnvFile)) { return }
    $patterns = @($Names | ForEach-Object { '^\s*' + [Regex]::Escape($_) + '\s*=' })
    $lines = @(Get-Content $EnvFile)
    $filtered = @($lines | Where-Object {
        $line = $_
        -not ($patterns | Where-Object { $line -match $_ })
    })
    Set-Content -Path $EnvFile -Value $filtered -Encoding UTF8
}

function Set-DotEnvValue([string]$Name, [string]$Value) {
    $lines = if (Test-Path $EnvFile) { @(Get-Content $EnvFile) } else { @() }
    $pattern = '^\s*' + [Regex]::Escape($Name) + '\s*='
    $replacement = "$Name=$Value"
    $updated = $false
    $out = foreach ($line in $lines) {
        if ($line -match $pattern) {
            if (-not $updated) { $replacement; $updated = $true }
        } else {
            $line
        }
    }
    if (-not $updated) { $out += $replacement }
    Set-Content -Path $EnvFile -Value $out -Encoding UTF8
}

function Get-DotEnvValue([string]$Name) {
    if (-not (Test-Path $EnvFile)) { return $null }
    $pattern = '^\s*' + [Regex]::Escape($Name) + '\s*=\s*(.*?)\s*$'
    foreach ($line in Get-Content $EnvFile) {
        if ($line -match $pattern) {
            $value = [string]$Matches[1]
            $value = $value.Trim()
            if ($value.Length -ge 2) {
                $first = $value.Substring(0, 1)
                $last = $value.Substring($value.Length - 1, 1)
                if (($first -eq '"' -and $last -eq '"') -or ($first -eq "'" -and $last -eq "'")) {
                    $value = $value.Substring(1, $value.Length - 2)
                }
            }
            return [Environment]::ExpandEnvironmentVariables($value)
        }
    }
    return $null
}

function Get-ConfiguredValue([string]$Name) {
    $processValue = [Environment]::GetEnvironmentVariable($Name, 'Process')
    if (-not [string]::IsNullOrWhiteSpace($processValue)) {
        return [Environment]::ExpandEnvironmentVariables($processValue.Trim())
    }
    return Get-DotEnvValue $Name
}

function Find-EngineInRoots([string[]]$Roots, [string[]]$Names) {
    foreach ($rootCandidate in $Roots) {
        if ([string]::IsNullOrWhiteSpace($rootCandidate)) { continue }
        $found = Find-EngineExecutable $rootCandidate $Names
        if ($found) { return $found }
    }
    return $null
}

function Resolve-EngineExecutable(
    [string]$VariableName,
    [string[]]$FallbackRoots,
    [string[]]$Names,
    [switch]$Optional
) {
    $configured = Get-ConfiguredValue $VariableName
    if (-not [string]::IsNullOrWhiteSpace($configured)) {
        if (Test-Path -LiteralPath $configured -PathType Leaf) {
            return (Resolve-Path -LiteralPath $configured).Path
        }
        throw "$VariableName punta a un file inesistente: $configured"
    }

    $found = Find-EngineInRoots $FallbackRoots $Names
    if ($found) { return $found }
    if ($Optional) { return $null }

    throw "$VariableName non configurato e motore non trovato. Imposta un percorso assoluto nel file .env."
}

function Configure-EnginePaths {
    $ExternalRuntime = 'C:\AFFETTA_RUNTIME\engines'

    $PrusaExe = Resolve-EngineExecutable `
        'PRUSA_SLICER_BIN' `
        @((Join-Path $Root 'runtime\engines\prusa'), (Join-Path $ExternalRuntime 'prusa')) `
        @('prusa-slicer-console.exe')

    $OrcaExe = Resolve-EngineExecutable `
        'ORCA_SLICER_BIN' `
        @((Join-Path $Root 'runtime\engines\orca'), (Join-Path $ExternalRuntime 'orca')) `
        @('orca-slicer.exe', 'OrcaSlicer.exe')

    $SnapmakerConfigured = Get-ConfiguredValue 'SNAPMAKER_ORCA_BIN'
    if (-not [string]::IsNullOrWhiteSpace($SnapmakerConfigured)) {
        if (-not (Test-Path -LiteralPath $SnapmakerConfigured -PathType Leaf)) {
            throw "SNAPMAKER_ORCA_BIN punta a un file inesistente: $SnapmakerConfigured"
        }
        $SnapmakerExe = (Resolve-Path -LiteralPath $SnapmakerConfigured).Path
    } else {
        $SnapmakerExe = Find-EngineInRoots `
            @((Join-Path $Root 'runtime\engines\snapmaker_orca'), (Join-Path $ExternalRuntime 'snapmaker_orca')) `
            @('snapmaker-orca.exe', 'orca-slicer.exe', 'OrcaSlicer.exe')
        if (-not $SnapmakerExe) { $SnapmakerExe = $OrcaExe }
    }

    $CuraExe = Resolve-EngineExecutable `
        'CURA_ENGINE_BIN' `
        @((Join-Path $Root 'runtimeenginescura'), (Join-Path $ExternalRuntime 'cura')) `
        @('CuraEngine.exe') `
        -Optional

    $GpxExe = Resolve-EngineExecutable `
        'GPX_BIN' `
        @((Join-Path $Root 'runtimeenginesgpx'), (Join-Path $ExternalRuntime 'gpx')) `
        @('gpx.exe') `
        -Optional

    # Le variabili legacy trasformavano i motori in comandi custom e bypassavano gli adattatori reali.
    $legacy = @(
        'AFFETTA_ENGINE_COMMAND_PRUSA',
        'AFFETTA_ENGINE_COMMAND_CURA',
        'AFFETTA_ENGINE_COMMAND_ORCA',
        'AFFETTA_ENGINE_COMMAND_SNAPMAKER_ORCA',
        'AFFETTA_ENGINE_COMMAND_GPX'
    )
    foreach ($name in $legacy) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
    Remove-DotEnvKeys $legacy

    # Manteniamo nel .env percorsi assoluti e verificati. Il launcher non li sostituisce più
    # con percorsi relativi alla cartella da cui viene eseguito.
    $env:PRUSA_SLICER_BIN = $PrusaExe
    $env:ORCA_SLICER_BIN = $OrcaExe
    $env:SNAPMAKER_ORCA_BIN = $SnapmakerExe
    if ($GpxExe) { $env:GPX_BIN = $GpxExe }
    Set-DotEnvValue 'PRUSA_SLICER_BIN' $PrusaExe
    Set-DotEnvValue 'ORCA_SLICER_BIN' $OrcaExe
    Set-DotEnvValue 'SNAPMAKER_ORCA_BIN' $SnapmakerExe
    if ($GpxExe) { Set-DotEnvValue 'GPX_BIN' $GpxExe }

    if ($CuraExe) {
        $env:CURA_ENGINE_BIN = $CuraExe
        Set-DotEnvValue 'CURA_ENGINE_BIN' $CuraExe
    }

    Write-StartupLog "PrusaSlicer: $PrusaExe"
    Write-StartupLog "OrcaSlicer: $OrcaExe"
    Write-StartupLog "Snapmaker U1: $SnapmakerExe"
    if ($CuraExe) { Write-StartupLog "CuraEngine: $CuraExe" }
}

try {
    Write-StartupLog "Avvio Affetta standalone v$ExpectedVersion..."
    $NodeExe = Ensure-Node

    if (-not (Test-Path $EnvFile)) {
        Write-StartupLog 'Creo la configurazione locale iniziale...'
        & $NodeExe (Join-Path $Root 'scripts\init.mjs')
        if ($LASTEXITCODE -ne 0) { throw 'Creazione della configurazione non riuscita.' }
    }

    Configure-EnginePaths

    $Port = Read-Port
    $BaseUrl = "http://127.0.0.1:$Port"
    $InstanceId = Get-InstanceId $Root
    $env:AFFETTA_INSTANCE_ID = $InstanceId
    $env:AFFETTA_BUILD_ID = 'windows-thingomatic-052'
    Set-DotEnvValue 'AFFETTA_INSTANCE_ID' $InstanceId
    Set-DotEnvValue 'AFFETTA_BUILD_ID' 'windows-thingomatic-052'

    $ExistingHealth = Test-AffettaHealth $BaseUrl
    if ($ExistingHealth -and $ExistingHealth.service -eq 'affetta') {
        $sameVersion = [string](Get-ObjectProperty $ExistingHealth 'version') -eq $ExpectedVersion
        $sameInstance = [string](Get-ObjectProperty $ExistingHealth 'instance_id') -eq $InstanceId
        if (-not $ForceRestart -and $sameVersion -and $sameInstance) {
            Write-StartupLog "Affetta v$ExpectedVersion è già attivo dalla cartella corretta su $BaseUrl"
            Start-Process $BaseUrl
            exit 0
        }
        Stop-ExistingAffetta $Port $BaseUrl
    } elseif (@(Get-ListenerPids $Port).Count -gt 0) {
        throw "La porta $Port è occupata da un'altra applicazione."
    }

    if (Test-Path $StdoutLog) { Remove-Item -Force $StdoutLog }
    if (Test-Path $StderrLog) { Remove-Item -Force $StderrLog }

    $Process = Start-Process -FilePath $NodeExe `
        -ArgumentList @('bootstrap.js') `
        -WorkingDirectory $Root `
        -RedirectStandardOutput $StdoutLog `
        -RedirectStandardError $StderrLog `
        -WindowStyle Hidden `
        -PassThru

    Set-Content -Path $PidFile -Value $Process.Id -Encoding ASCII
    $ServerStarted = $true
    Write-StartupLog "Server avviato con PID $($Process.Id). Verifico versione, cartella e motori..."

    $Health = $null
    for ($i = 0; $i -lt 120; $i++) {
        Start-Sleep -Milliseconds 250
        $Process.Refresh()
        if ($Process.HasExited) {
            $details = if (Test-Path $StderrLog) { Get-Content $StderrLog -Raw } else { '' }
            throw "Il server si è arrestato durante l'avvio.`n$details"
        }
        $Health = Test-AffettaHealth $BaseUrl
        if ($Health -and (Get-ObjectProperty $Health 'service') -eq 'affetta' -and [string](Get-ObjectProperty $Health 'version') -eq $ExpectedVersion -and [string](Get-ObjectProperty $Health 'instance_id') -eq $InstanceId) {
            break
        }
        $Health = $null
    }

    if (-not $Health) {
        Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
        throw "Il server sulla porta $Port non corrisponde ad Affetta v$ExpectedVersion nella cartella $Root."
    }

    if ($RunLiveSelfTest) {
        Write-StartupLog 'Eseguo il collaudo attraverso il server realmente avviato...'
        & $NodeExe (Join-Path $Root 'scripts\live-production-selftest.mjs')
        if ($LASTEXITCODE -ne 0) {
            $Process.Refresh()
            $healthAfterTest = Test-AffettaHealth $BaseUrl
            $aliveText = if (-not $Process.HasExited -and $healthAfterTest) { 'Il server è ancora attivo.' } elseif ($Process.HasExited) { "Il server si è arrestato con exit code $($Process.ExitCode)." } else { 'Il server non risponde alla health check.' }
            throw "Il collaudo HTTP del server avviato non è riuscito. $aliveText Consulta data\live-production-selftest.json, data\runtime-diagnostics.jsonl, data\process-crash.jsonl e data\server.stderr.log."
        }
    }

    Write-StartupLog "Affetta v$ExpectedVersion è attivo su $BaseUrl"
    Start-Process $BaseUrl
    Write-Host ''
    Write-Host 'Affetta è stato avviato e verificato correttamente.' -ForegroundColor Green
    Write-Host "Versione: $ExpectedVersion"
    Write-Host "Indirizzo: $BaseUrl"
    Write-Host 'Per arrestarlo usa ARRESTA_AFFETTA.cmd.'
    exit 0
} catch {
    Write-StartupLog "ERRORE: $($_.Exception.Message)"
    Write-Host ''
    $serverAlive = $false
    if ($ServerStarted -and $Process) {
        try {
            $Process.Refresh()
            $serverAlive = (-not $Process.HasExited) -and ($null -ne (Test-AffettaHealth $BaseUrl))
        } catch { $serverAlive = $false }
    }
    if ($serverAlive) {
        Write-Host 'Affetta è avviato, ma il collaudo HTTP non è stato superato.' -ForegroundColor Yellow
        Write-Host "PID server: $($Process.Id)"
        Write-Host "Indirizzo: $BaseUrl"
    } else {
        Write-Host 'Affetta non è attivo.' -ForegroundColor Red
        if ($Process -and $Process.HasExited) { Write-Host "Exit code server: $($Process.ExitCode)" }
    }
    Write-Host "Dettagli: $($_.Exception.Message)"
    Write-Host "Log avvio: $StartupLog"
    Write-Host "Log server: $StderrLog"
    Write-Host "Diagnostica runtime: $(Join-Path $DataDir 'runtime-diagnostics.jsonl')"
    Write-Host "Crash process-level: $(Join-Path $DataDir 'process-crash.jsonl')"
    exit 1
}
