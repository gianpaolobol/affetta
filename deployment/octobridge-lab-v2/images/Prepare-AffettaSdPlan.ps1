[CmdletBinding()]
param(
    [string]$RuntimeRoot = 'C:\AFFETTA_RUNTIME'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Target = Join-Path $RuntimeRoot 'octobridge-sd-plan'
New-Item -ItemType Directory -Force -Path $Target | Out-Null
Copy-Item -LiteralPath (Join-Path $ScriptRoot 'octopi-image-matrix.json') -Destination $Target -Force
Copy-Item -LiteralPath (Join-Path $ScriptRoot 'NODE_ASSIGNMENTS_TEMPLATE.csv') -Destination $Target -Force
$Labels = Join-Path $Target 'labels'
New-Item -ItemType Directory -Force -Path $Labels | Out-Null
$Machines = Get-Content -LiteralPath (Join-Path (Split-Path -Parent $ScriptRoot) 'machines\index.json') -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($Machine in $Machines.machines) {
    $Text = @(
        'AFFETTA OCTOBRIDGE',
        [string]$Machine.fleet_unit_id,
        [string]$Machine.display_name,
        "$($Machine.hostname).local",
        [string]$Machine.bridge_id
    ) -join [Environment]::NewLine
    [System.IO.File]::WriteAllText((Join-Path $Labels "$($Machine.fleet_unit_id).txt"), $Text, (New-Object System.Text.UTF8Encoding($false)))
}
Write-Host "Piano SD preparato in: $Target"
