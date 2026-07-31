$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root
$Packages = Join-Path $Root 'runtime\packages'
$Engines = Join-Path $Root 'runtime\engines'
$Log = Join-Path $Root 'data\engine-install.log'
New-Item -ItemType Directory -Force -Path $Engines,(Split-Path $Log -Parent) | Out-Null

$Expected = @{
  'PrusaSlicer-2.9.6-setup.exe' = '6820d15f922908c3692cea2bdef7b5a2556fab1b7b55f4c312a89272b5eb8052'
  'OrcaSlicer_Windows_V2.4.2_x64_portable.zip' = 'feba3009dfb9d268779cca5758a1a5bc3b7d0722bf8fa48d5c57340de975d6be'
  'Snapmaker_Orca_Windows_V2.3.5_portable.zip' = '053fdbb622b0c20fb4de30a677a487786a992efebf82451e39cada9900aea169'
  'UltiMaker-Cura-5.13.0-win64-X64.msi' = 'd049b1e9bd80adb2defbb76fcd8e5bfc395e297bd0141b4f2894e37d09d1c33c'
}

function Log([string]$Text) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Text"
  Add-Content -LiteralPath $Log -Value $line -Encoding UTF8
  Write-Host $Text
}

function Resolve-ExecutablePath($Candidate) {
  if ($null -eq $Candidate) { return $null }
  if ($Candidate -is [string]) { return [string]$Candidate }
  foreach ($name in @('FullName','Path','Source','Definition')) {
    $property = $Candidate.PSObject.Properties[$name]
    if ($null -ne $property -and -not [string]::IsNullOrWhiteSpace([string]$property.Value)) {
      return [string]$property.Value
    }
  }
  return $null
}

function Find-NodePath {
  $runtimeNode = Get-ChildItem -LiteralPath (Join-Path $Root 'runtime') -Filter node.exe -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
  $path = Resolve-ExecutablePath $runtimeNode
  if ($path) { return $path }
  $systemNode = Get-Command node.exe -ErrorAction SilentlyContinue
  return Resolve-ExecutablePath $systemNode
}

function Assert-Package([string]$Name) {
  $File = Join-Path $Packages $Name
  if (-not (Test-Path -LiteralPath $File)) { throw "Pacchetto mancante: $Name" }
  $Hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $File).Hash.ToLowerInvariant()
  if ($Hash -ne $Expected[$Name]) { throw "Checksum non valido per $Name" }
  Log "Verificato: $Name"
  return $File
}

function Reset-Dir([string]$Path) {
  if (Test-Path -LiteralPath $Path) { Remove-Item -LiteralPath $Path -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $Path | Out-Null
}

function Find-Exe([string]$Directory, [string]$ExeName) {
  return Get-ChildItem -LiteralPath $Directory -Filter $ExeName -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
}

function Expand-PortableEngine(
  [string]$Archive,
  [string]$Destination,
  [string]$ExpectedExe,
  [bool]$StripFirstDirectory,
  [string]$Label
) {
  Reset-Dir $Destination
  $tarCommand = Get-Command tar.exe -ErrorAction SilentlyContinue
  $tarPath = Resolve-ExecutablePath $tarCommand
  $usedTar = $false

  if ($tarPath) {
    Log "Estrazione di $Label con tar.exe..."
    $arguments = @('-xf', $Archive)
    if ($StripFirstDirectory) { $arguments += '--strip-components=1' }
    $arguments += @('-C', $Destination)
    & $tarPath @arguments
    if ($LASTEXITCODE -ne 0) {
      throw "tar.exe non ha potuto estrarre $Label (codice $LASTEXITCODE)."
    }
    $usedTar = $true
  }

  if (-not $usedTar) {
    $temp = Join-Path ([System.IO.Path]::GetTempPath()) ("AffettaEngine_" + [Guid]::NewGuid().ToString('N'))
    try {
      New-Item -ItemType Directory -Force -Path $temp | Out-Null
      Log "Estrazione di $Label in area temporanea..."
      Expand-Archive -LiteralPath $Archive -DestinationPath $temp -Force
      $exe = Find-Exe $temp $ExpectedExe
      if (-not $exe) { throw "$ExpectedExe non trovato nell'archivio di $Label." }
      $exePath = Resolve-ExecutablePath $exe
      $sourceRoot = Split-Path -Parent $exePath
      Get-ChildItem -LiteralPath $sourceRoot -Force | ForEach-Object {
        $sourcePath = Resolve-ExecutablePath $_
        Copy-Item -LiteralPath $sourcePath -Destination $Destination -Recurse -Force
      }
    }
    finally {
      if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue }
    }
  }

  $installedExe = Find-Exe $Destination $ExpectedExe
  if (-not $installedExe) { throw "$ExpectedExe non trovato dopo l'estrazione di $Label." }
  $installedPath = Resolve-ExecutablePath $installedExe
  Log "$Label preparato in: $(Split-Path -Parent $installedPath)"
  return $installedPath
}

function Invoke-SelfTests([string]$NodePath) {
  Log 'Verifica dei preset ufficiali e dell’abbinamento automatico...'
  & $NodePath (Join-Path $Root 'scripts\profile-asset-selftest.mjs') 2>&1 | Tee-Object -FilePath (Join-Path $Root 'data\profile-selftest.json')
  $profileCode = $LASTEXITCODE
  if ($profileCode -ne 0) { throw "La verifica dei preset ha restituito codice $profileCode. Consulta data\profile-selftest.json." }

  Log 'Avvio del slicing reale con i quattro motori...'
  & $NodePath (Join-Path $Root 'scripts\engine-selftest.mjs') 2>&1 | Tee-Object -FilePath (Join-Path $Root 'data\engine-selftest.json')
  $engineCode = $LASTEXITCODE
  if ($engineCode -ne 0) { throw "Il collaudo reale ha restituito codice $engineCode. Consulta data\engine-selftest.json e data\engine-install.log." }
}

try {
  if ($Root.Length -gt 75) {
    Log "ATTENZIONE: il percorso di Affetta e lungo ($($Root.Length) caratteri). Per la massima compatibilita usa C:\Affetta."
  }

  Log 'Preparazione motori Affetta inclusi nel pacchetto...'
  $PrusaPackage = Assert-Package 'PrusaSlicer-2.9.6-setup.exe'
  $OrcaPackage = Assert-Package 'OrcaSlicer_Windows_V2.4.2_x64_portable.zip'
  $SnapPackage = Assert-Package 'Snapmaker_Orca_Windows_V2.3.5_portable.zip'
  $CuraPackage = Assert-Package 'UltiMaker-Cura-5.13.0-win64-X64.msi'

  $OrcaDir = Join-Path $Engines 'orca'
  [void](Expand-PortableEngine $OrcaPackage $OrcaDir 'orca-slicer.exe' $false 'OrcaSlicer 2.4.2')

  $SnapDir = Join-Path $Engines 'snapmaker_orca'
  [void](Expand-PortableEngine $SnapPackage $SnapDir 'snapmaker-orca.exe' $true 'Snapmaker Orca 2.3.5')

  $PrusaDir = Join-Path $Engines 'prusa'
  Reset-Dir $PrusaDir
  Log 'Estrazione silenziosa di PrusaSlicer 2.9.6...'
  $PrusaArgs = @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/SP-',"/DIR=$PrusaDir")
  $p = Start-Process -FilePath $PrusaPackage -ArgumentList $PrusaArgs -Wait -PassThru
  if ($p.ExitCode -ne 0) { throw "Installer PrusaSlicer terminato con codice $($p.ExitCode)." }
  if (-not (Find-Exe $PrusaDir 'prusa-slicer-console.exe')) { throw 'prusa-slicer-console.exe non trovato dopo l’estrazione.' }
  Log 'PrusaSlicer 2.9.6 preparato.'

  $CuraDir = Join-Path $Engines 'cura'
  Reset-Dir $CuraDir
  Log 'Estrazione amministrativa di UltiMaker Cura 5.13.0...'
  $msiArgs = @('/a',"`"$CuraPackage`"",'/qn','/norestart',"TARGETDIR=`"$CuraDir`"")
  $m = Start-Process -FilePath 'msiexec.exe' -ArgumentList $msiArgs -Wait -PassThru
  if ($m.ExitCode -ne 0) { throw "Estrazione Cura terminata con codice $($m.ExitCode)." }
  if (-not (Find-Exe $CuraDir 'CuraEngine.exe')) { throw 'CuraEngine.exe non trovato dopo l’estrazione.' }
  $definitions = Get-ChildItem -LiteralPath $CuraDir -Directory -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match 'resources\\definitions$' } | Select-Object -First 1
  if (-not $definitions) { throw 'Le definizioni macchina di Cura non sono state trovate.' }
  Log 'UltiMaker Cura / CuraEngine 5.13.0 preparato.'

  Set-Content -LiteralPath (Join-Path $Engines '.prepared') -Value (Get-Date -Format o) -Encoding ASCII
  Log 'Tutti i motori sono stati preparati.'
  Write-Host ''
  Write-Host 'Avvio il collaudo reale dei motori...' -ForegroundColor Cyan
  $NodePath = Find-NodePath
  if ($NodePath) {
    Invoke-SelfTests $NodePath
  } else {
    Log 'Node.js non disponibile: avvia prima Affetta, poi esegui VERIFICA_MOTORI_AFFETTA.cmd.'
  }
  Write-Host ''
  Write-Host 'Preparazione completata.' -ForegroundColor Green
}
catch {
  Log "ERRORE: $($_.Exception.Message)"
  Write-Host ''
  Write-Host 'Preparazione non completata.' -ForegroundColor Red
  Write-Host $_.Exception.Message
  exit 1
}
