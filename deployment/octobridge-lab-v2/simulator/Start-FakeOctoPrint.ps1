[CmdletBinding()]
param(
    [int]$Port = 5000,
    [string]$ApiKey = 'AFFETTA_FAKE_OCTOPRINT_KEY',
    [string]$ControlKey = 'AFFETTA_SIMULATOR_CONTROL',
    [string]$DataDirectory
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $DataDirectory) {
    $DataDirectory = Join-Path $env:TEMP 'affetta-fake-octoprint'
}
$Python = Get-Command python -ErrorAction Stop
& $Python.Source (Join-Path $ScriptRoot 'fake_octoprint.py') `
    --host 127.0.0.1 `
    --port $Port `
    --api-key $ApiKey `
    --control-key $ControlKey `
    --data-dir $DataDirectory
exit $LASTEXITCODE
