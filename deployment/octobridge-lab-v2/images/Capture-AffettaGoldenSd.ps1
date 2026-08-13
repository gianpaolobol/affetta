[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateRange(1, 999)]
    [int]$DiskNumber,

    [string]$OutputDirectory = 'C:\AFFETTA_IMAGES',

    [string]$ImageName = 'AFFETTA_OCTOBRIDGE_SD_V1_EXPERIMENTAL_2026-08-13.img'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Assert-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Apri PowerShell come Amministratore e riesegui lo script.'
    }
}

Assert-Administrator

$disk = Get-Disk -Number $DiskNumber

if ($disk.IsBoot -or $disk.IsSystem) {
    throw "BLOCCATO: Disk $DiskNumber e' un disco di sistema/boot."
}

$allowedBus = @('USB', 'SD', 'MMC')
$bus = [string]$disk.BusType
if ($allowedBus -notcontains $bus) {
    throw "BLOCCATO: BusType '$bus' non ammesso. Attesi: $($allowedBus -join ', ')."
}

Write-Host ''
Write-Host '=== AFFETTA GOLDEN SD CAPTURE ===' -ForegroundColor Cyan
Write-Host ("DiskNumber : {0}" -f $disk.Number)
Write-Host ("FriendlyName: {0}" -f $disk.FriendlyName)
Write-Host ("BusType     : {0}" -f $disk.BusType)
Write-Host ("Size        : {0:N2} GiB" -f ($disk.Size / 1GB))
Write-Host ("Partition   : {0}" -f $disk.PartitionStyle)
Write-Host ''
Write-Host 'Questa operazione e'' SOLO LETTURA sulla SD sorgente.' -ForegroundColor Yellow
Write-Host 'Non usare questo script su un disco diverso dalla SD Affetta validata.' -ForegroundColor Yellow
Write-Host ''

$expected = "CAPTURE $DiskNumber"
$confirm = Read-Host "Digita esattamente '$expected' per continuare"
if ($confirm -cne $expected) {
    throw 'Conferma non valida. Nessuna immagine creata.'
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

$imagePath = Join-Path $OutputDirectory $ImageName
$shaPath = "$imagePath.sha256.txt"
$manifestPath = "$imagePath.manifest.json"

if (Test-Path -LiteralPath $imagePath) {
    throw "Il file esiste gia': $imagePath"
}

$physicalDrive = "\\.\PhysicalDrive$DiskNumber"
$bufferSize = 4MB
$buffer = New-Object byte[] $bufferSize

Write-Host ''
Write-Host "Lettura raw da $physicalDrive" -ForegroundColor Cyan
Write-Host "Destinazione: $imagePath" -ForegroundColor Cyan
Write-Host ''

$source = New-Object System.IO.FileStream(
    $physicalDrive,
    [System.IO.FileMode]::Open,
    [System.IO.FileAccess]::Read,
    [System.IO.FileShare]::ReadWrite,
    $bufferSize,
    [System.IO.FileOptions]::SequentialScan
)

$target = New-Object System.IO.FileStream(
    $imagePath,
    [System.IO.FileMode]::CreateNew,
    [System.IO.FileAccess]::Write,
    [System.IO.FileShare]::None,
    $bufferSize,
    [System.IO.FileOptions]::SequentialScan
)

$total = [int64]0
$lastPercent = -1

try {
    while ($total -lt [int64]$disk.Size) {
        $remaining = [int64]$disk.Size - $total
        $toRead = [int][Math]::Min([int64]$buffer.Length, $remaining)
        $read = $source.Read($buffer, 0, $toRead)

        if ($read -le 0) {
            throw "Fine lettura inattesa dopo $total byte su $($disk.Size)."
        }

        $target.Write($buffer, 0, $read)
        $total += $read

        $percent = [int](($total * 100.0) / $disk.Size)
        if ($percent -ne $lastPercent) {
            Write-Progress -Activity 'Creazione immagine SD Affetta' `
                           -Status "$percent% - $total / $($disk.Size) byte" `
                           -PercentComplete $percent
            $lastPercent = $percent
        }
    }

    $target.Flush()
}
finally {
    $target.Dispose()
    $source.Dispose()
    Write-Progress -Activity 'Creazione immagine SD Affetta' -Completed
}

$file = Get-Item -LiteralPath $imagePath
if ($file.Length -ne [int64]$disk.Size) {
    throw "Dimensione immagine errata: $($file.Length) byte, attesi $($disk.Size)."
}

Write-Host ''
Write-Host 'Calcolo SHA-256...' -ForegroundColor Cyan
$hash = Get-FileHash -Algorithm SHA256 -LiteralPath $imagePath

"$($hash.Hash)  $($file.Name)" |
    Set-Content -LiteralPath $shaPath -Encoding ASCII

$manifest = [ordered]@{
    schema_version = 'affetta.octobridge-golden-image.v1'
    baseline_id = 'AFFETTA-OCTOBRIDGE-SD-V1'
    artifact_status = 'experimental_not_production_ready'
    captured_at = (Get-Date).ToString('o')
    source_disk = [ordered]@{
        disk_number = $disk.Number
        friendly_name = $disk.FriendlyName
        bus_type = [string]$disk.BusType
        size_bytes = [int64]$disk.Size
        partition_style = [string]$disk.PartitionStyle
    }
    image = [ordered]@{
        filename = $file.Name
        size_bytes = [int64]$file.Length
        sha256 = $hash.Hash
    }
    source_pilot = 'taz-03'
    production_ready = $false
    clone_warning = 'Prima di avviare piu cloni contemporaneamente, personalizzare hostname/identita nodo e rigenerare le SSH host keys.'
}

$manifest |
    ConvertTo-Json -Depth 6 |
    Set-Content -LiteralPath $manifestPath -Encoding UTF8

Write-Host ''
Write-Host '=== CAPTURE PASS ===' -ForegroundColor Green
Write-Host "IMG      : $imagePath"
Write-Host "SHA256   : $($hash.Hash)"
Write-Host "CHECKSUM : $shaPath"
Write-Host "MANIFEST : $manifestPath"
Write-Host ''
Write-Host 'La sorgente non e'' stata modificata.' -ForegroundColor Green
Write-Host 'Baseline: EXPERIMENTAL / production_ready=false' -ForegroundColor Yellow
