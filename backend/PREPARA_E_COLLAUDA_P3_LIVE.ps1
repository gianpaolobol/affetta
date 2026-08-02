[CmdletBinding()]
param(
    [string]$RepoPath = 'C:\AFFETTA_GITHUB_0412',
    [switch]$RegenerateEnvironment,
    [switch]$StopAfterTest
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ProjectName = 'affetta-p3'
$BackendDir = Join-Path $RepoPath 'backend'
$EnvPath = Join-Path $BackendDir '.env'
$ReportPath = Join-Path $BackendDir ('live-test-report-{0}.json' -f (Get-Date -Format 'yyyyMMdd-HHmmss'))

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$ArgumentList
    )
    & $FilePath @ArgumentList
    if ($LASTEXITCODE -ne 0) {
        throw "Comando fallito ($LASTEXITCODE): $FilePath $($ArgumentList -join ' ')"
    }
}

function New-HexSecret {
    param([int]$Bytes = 24)
    $buffer = New-Object byte[] $Bytes
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }
    return -join ($buffer | ForEach-Object { $_.ToString('x2') })
}

function Read-DotEnv {
    param([string]$Path)
    $values = @{}
    foreach ($raw in Get-Content -LiteralPath $Path) {
        $line = $raw.Trim()
        if (-not $line -or $line.StartsWith('#')) { continue }
        $index = $line.IndexOf('=')
        if ($index -lt 1) { continue }
        $values[$line.Substring(0, $index).Trim()] = $line.Substring($index + 1).Trim()
    }
    return $values
}

function Wait-Ready {
    param([int]$Seconds = 240)
    $deadline = (Get-Date).AddSeconds($Seconds)
    $lastError = ''
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-RestMethod -Uri 'http://127.0.0.1:8790/readyz' -Method Get -TimeoutSec 5
            if ($response.ok -eq $true) { return $response }
            $lastError = ($response | ConvertTo-Json -Depth 20 -Compress)
        }
        catch { $lastError = $_.Exception.Message }
        Start-Sleep -Seconds 3
    }
    throw "Backend non ready entro $Seconds secondi. Ultimo errore: $lastError"
}

function Convert-BytesToSha256 {
    param([byte[]]$Bytes)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { $hash = $sha.ComputeHash($Bytes) } finally { $sha.Dispose() }
    return -join ($hash | ForEach-Object { $_.ToString('x2') })
}

if (-not (Test-Path -LiteralPath $BackendDir -PathType Container)) {
    throw "Cartella backend non trovata: $BackendDir"
}

$DockerExe = (Get-Command docker.exe -ErrorAction Stop).Source
Push-Location -LiteralPath $BackendDir
$started = $false
$checks = [ordered]@{}
try {
    Invoke-Checked -FilePath $DockerExe -ArgumentList @('info')
    $checks.docker = 'ok'

    if ((Test-Path -LiteralPath $EnvPath) -and $RegenerateEnvironment) {
        $backup = "$EnvPath.backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
        Copy-Item -LiteralPath $EnvPath -Destination $backup -Force
        Remove-Item -LiteralPath $EnvPath -Force
        Write-Host "Backup configurazione precedente: $backup" -ForegroundColor Yellow
    }

    if (-not (Test-Path -LiteralPath $EnvPath)) {
        $postgresPassword = New-HexSecret 24
        $minioPassword = New-HexSecret 24
        $apiKey = "affetta_api_$(New-HexSecret 24)"
        $pairingCode = "AFFETTA-$(New-HexSecret 12)".ToUpperInvariant()
        $content = @"
AFFETTA_P31_ENV=1
AFFETTA_BACKEND_MODE=production
AFFETTA_BACKEND_HOST=0.0.0.0
AFFETTA_BACKEND_PORT=8790
AFFETTA_BACKEND_PUBLIC_URL=http://127.0.0.1:8790
AFFETTA_BIND_HOST=127.0.0.1

POSTGRES_DB=affetta
POSTGRES_USER=affetta
POSTGRES_PASSWORD=$postgresPassword
DATABASE_URL=postgresql://affetta:$postgresPassword@postgres:5432/affetta
REDIS_URL=redis://redis:6379

MINIO_ROOT_USER=affetta-minio
MINIO_ROOT_PASSWORD=$minioPassword
S3_ENDPOINT=http://minio:9000
S3_PUBLIC_ENDPOINT=http://127.0.0.1:9000
S3_REGION=eu-central-1
S3_BUCKET=affetta-artifacts
S3_ACCESS_KEY_ID=affetta-minio
S3_SECRET_ACCESS_KEY=$minioPassword
S3_FORCE_PATH_STYLE=true
S3_SIGNED_URL_TTL_SECONDS=900
S3_VERIFY_MAX_BYTES=250000000

AFFETTA_BOOTSTRAP_ORG_ID=org_affetta_local
AFFETTA_BOOTSTRAP_ORG_NAME=Affetta Local
AFFETTA_BOOTSTRAP_API_KEY=$apiKey
AFFETTA_BOOTSTRAP_PAIRING_CODE=$pairingCode
AFFETTA_CONTRACTS_ROOT=/app/schemas

AFFETTA_LEASE_SECONDS=180
AFFETTA_LEASE_RENEW_SECONDS=180
AFFETTA_JOB_MAX_ATTEMPTS=3
AFFETTA_RETRY_BASE_SECONDS=30
AFFETTA_ARTIFACT_RETENTION_HOURS=72
AFFETTA_MAX_JSON_BYTES=2000000
"@
        Set-Content -LiteralPath $EnvPath -Value $content.TrimStart() -Encoding Ascii
        Write-Host 'Configurazione .env generata con credenziali casuali.' -ForegroundColor Green
    }

    $envValues = Read-DotEnv -Path $EnvPath
    foreach ($required in @('POSTGRES_DB','POSTGRES_USER','POSTGRES_PASSWORD','MINIO_ROOT_USER','MINIO_ROOT_PASSWORD','AFFETTA_BOOTSTRAP_API_KEY','S3_PUBLIC_ENDPOINT')) {
        if (-not $envValues.ContainsKey($required) -or -not $envValues[$required]) {
            throw "Variabile obbligatoria mancante in .env: $required"
        }
    }
    if ($envValues['S3_PUBLIC_ENDPOINT'] -ne 'http://127.0.0.1:9000') {
        throw 'Per il primo collaudo locale S3_PUBLIC_ENDPOINT deve essere http://127.0.0.1:9000.'
    }

    Write-Host 'Validazione Docker Compose...' -ForegroundColor Cyan
    Invoke-Checked -FilePath $DockerExe -ArgumentList @('compose','--project-name',$ProjectName,'config','--quiet')

    Write-Host 'Download immagini e build backend...' -ForegroundColor Cyan
    Invoke-Checked -FilePath $DockerExe -ArgumentList @('compose','--project-name',$ProjectName,'pull','postgres','redis','minio','minio-init')
    Invoke-Checked -FilePath $DockerExe -ArgumentList @('compose','--project-name',$ProjectName,'build','--pull','backend-migrate','backend')

    Write-Host 'Avvio PostgreSQL, Redis, MinIO e backend...' -ForegroundColor Cyan
    Invoke-Checked -FilePath $DockerExe -ArgumentList @('compose','--project-name',$ProjectName,'up','-d','--remove-orphans')
    $started = $true

    $ready = Wait-Ready
    $checks.readyz = 'ok'

    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8790/healthz' -Method Get -TimeoutSec 10
    if ($health.ok -ne $true) { throw '/healthz non valido.' }
    $checks.healthz = 'ok'

    $minioHealth = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:9000/minio/health/live' -TimeoutSec 10
    if ($minioHealth.StatusCode -ne 200) { throw 'Health MinIO non valido.' }
    $checks.minio = 'ok'

    $redisPing = (& $DockerExe compose --project-name $ProjectName exec -T redis redis-cli ping).Trim()
    if ($LASTEXITCODE -ne 0 -or $redisPing -ne 'PONG') { throw "Redis PING fallito: $redisPing" }
    $checks.redis = 'ok'

    $migrationCount = (& $DockerExe compose --project-name $ProjectName exec -T postgres psql -U $envValues['POSTGRES_USER'] -d $envValues['POSTGRES_DB'] -tAc "SELECT count(*) FROM schema_migrations WHERE name='001_initial.sql';").Trim()
    if ($LASTEXITCODE -ne 0 -or $migrationCount -ne '1') { throw "Migrazione PostgreSQL non verificata: $migrationCount" }
    $checks.postgres_migration = 'ok'

    Write-Host 'Test URL firmato e verifica checksum S3...' -ForegroundColor Cyan
    $payloadBytes = [System.Text.Encoding]::UTF8.GetBytes("solid affetta live test $(New-HexSecret 8)")
    $payloadSha = Convert-BytesToSha256 -Bytes $payloadBytes
    $apiHeaders = @{ 'x-api-key' = $envValues['AFFETTA_BOOTSTRAP_API_KEY'] }
    $prepareBody = @{
        filename = 'affetta-live-test.stl'
        format = 'stl'
        type = 'model'
        sha256 = $payloadSha
        size_bytes = $payloadBytes.Length
        media_type = 'model/stl'
    } | ConvertTo-Json -Depth 10
    $prepared = Invoke-RestMethod -Uri 'http://127.0.0.1:8790/v1/artifacts/prepare-upload' -Method Post -Headers $apiHeaders -ContentType 'application/json' -Body $prepareBody -TimeoutSec 30
    $signedUri = [Uri]$prepared.upload.url
    if ($signedUri.Host -ne '127.0.0.1' -or $signedUri.Port -ne 9000) {
        throw "URL firmato non raggiungibile da Windows: $($prepared.upload.url)"
    }
    Invoke-WebRequest -UseBasicParsing -Uri $prepared.upload.url -Method Put -ContentType 'model/stl' -Body $payloadBytes -TimeoutSec 60 | Out-Null
    $completeBody = @{ sha256 = $payloadSha; size_bytes = $payloadBytes.Length } | ConvertTo-Json
    $verified = Invoke-RestMethod -Uri ("http://127.0.0.1:8790/v1/artifacts/{0}/upload-complete" -f $prepared.artifact.id) -Method Post -Headers $apiHeaders -ContentType 'application/json' -Body $completeBody -TimeoutSec 60
    if ($verified.artifact.status -ne 'verified') { throw 'Artefatto S3 non verificato.' }
    $checks.s3_signed_upload_checksum = 'ok'

    Write-Host 'Test job PostgreSQL/Redis, idempotenza e cancellazione...' -ForegroundColor Cyan
    $suffix = New-HexSecret 8
    $jobRequest = @{
        schema_version = 'affetta.job.v1'
        request_id = "req_live_$suffix"
        idempotency_key = "live-$suffix"
        source = 'api'
        operation = 'slice'
        input = @{
            artifact_id = $prepared.artifact.id
            filename = 'affetta-live-test.stl'
            format = 'stl'
            sha256 = $payloadSha
            size_bytes = $payloadBytes.Length
        }
        print_intent = @{
            material_id = 'pla'
            quality_id = 'standard'
            strength_id = 'standard'
            color_id = 'natural'
            quantity = 1
            nozzle_mm = 0.4
            requested_output_format = 'gcode'
        }
        routing = @{ mode = 'automatic'; require_production_ready = $true }
    }
    $jobJson = $jobRequest | ConvertTo-Json -Depth 20
    $created = Invoke-RestMethod -Uri 'http://127.0.0.1:8790/v1/jobs' -Method Post -Headers $apiHeaders -ContentType 'application/json' -Body $jobJson -TimeoutSec 30
    $replayed = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8790/v1/jobs' -Method Post -Headers $apiHeaders -ContentType 'application/json' -Body $jobJson -TimeoutSec 30
    if ($replayed.StatusCode -ne 200 -or $replayed.Headers['idempotency-replayed'] -ne 'true') {
        throw 'Replay idempotente non verificato.'
    }
    $jobId = $created.job.id
    $cancelled = Invoke-RestMethod -Uri ("http://127.0.0.1:8790/v1/jobs/{0}/cancel" -f $jobId) -Method Post -Headers $apiHeaders -ContentType 'application/json' -Body '{}' -TimeoutSec 30
    if ($cancelled.job.status -ne 'cancelled') { throw 'Cancellazione job non verificata.' }
    $checks.job_idempotency_cancel = 'ok'

    Write-Host 'Riavvio backend e verifica persistenza PostgreSQL...' -ForegroundColor Cyan
    Invoke-Checked -FilePath $DockerExe -ArgumentList @('compose','--project-name',$ProjectName,'restart','backend')
    $null = Wait-Ready
    $persisted = Invoke-RestMethod -Uri ("http://127.0.0.1:8790/v1/jobs/{0}" -f $jobId) -Method Get -Headers $apiHeaders -TimeoutSec 30
    if ($persisted.job.id -ne $jobId -or $persisted.job.status -ne 'cancelled') { throw 'Persistenza job dopo riavvio non verificata.' }
    $checks.persistence_after_restart = 'ok'

    $metrics = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8790/metrics' -TimeoutSec 10
    if ($metrics.StatusCode -ne 200 -or $metrics.Content -notmatch 'http_requests_total') { throw 'Metriche backend non valide.' }
    $checks.metrics = 'ok'

    $report = [ordered]@{
        tested_at = (Get-Date).ToUniversalTime().ToString('o')
        result = 'passed'
        docker_server = (& $DockerExe version --format '{{.Server.Version}}').Trim()
        project = $ProjectName
        ready = $ready
        checks = $checks
        live_job_id = $jobId
        live_artifact_id = $prepared.artifact.id
        endpoints = @{
            backend = 'http://127.0.0.1:8790'
            minio_api = 'http://127.0.0.1:9000'
            minio_console = 'http://127.0.0.1:9001'
        }
        secrets_included = $false
    }
    $report | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $ReportPath -Encoding UTF8

    Write-Host ''
    Write-Host '=== COLLAUDO LIVE P3 SUPERATO ===' -ForegroundColor Green
    Write-Host "Report: $ReportPath"
    Invoke-Checked -FilePath $DockerExe -ArgumentList @('compose','--project-name',$ProjectName,'ps')

    if ($StopAfterTest) {
        Invoke-Checked -FilePath $DockerExe -ArgumentList @('compose','--project-name',$ProjectName,'stop')
        Write-Host 'Stack fermato senza eliminare volumi.' -ForegroundColor Yellow
    } else {
        Write-Host 'Stack lasciato attivo. Non avviare ancora l Agent operativo.' -ForegroundColor Yellow
    }
}
catch {
    Write-Host ("ERRORE COLLAUDO LIVE: {0}" -f $_.Exception.Message) -ForegroundColor Red
    if ($started) {
        & $DockerExe compose --project-name $ProjectName ps
        & $DockerExe compose --project-name $ProjectName logs --no-color --tail 120 backend backend-migrate postgres redis minio minio-init
    }
    exit 1
}
finally {
    Pop-Location
}
