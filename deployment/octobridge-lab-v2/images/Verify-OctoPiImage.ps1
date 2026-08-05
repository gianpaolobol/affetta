[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$ImageFile,
    [string]$ExpectedSha256 = '5cfb364cee2c4d73e6b16db2297bbc5f86895e840820f135d9832a002442fdc2'
)
$ErrorActionPreference = 'Stop'
$File = Get-Item -LiteralPath $ImageFile -ErrorAction Stop
$Actual = (Get-FileHash -LiteralPath $File.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
$Expected = $ExpectedSha256.ToLowerInvariant()
Write-Host "File:     $($File.FullName)"
Write-Host "SHA-256:  $Actual"
if ($Actual -ne $Expected) { throw "Checksum non corrispondente. Atteso: $Expected" }
Write-Host '[OK] Immagine OctoPi verificata.'
