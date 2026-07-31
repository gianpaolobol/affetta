$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
& (Join-Path $Root 'scripts\prepare-bundled-engines-windows.ps1')
exit $LASTEXITCODE
