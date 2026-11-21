param([switch]$Rules, [switch]$Android, [switch]$NoPub, [string]$FlutterCommand = 'flutter.bat')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$flutterInfo = & $FlutterCommand --version --machine
if ($LASTEXITCODE -ne 0) { throw 'Unable to read the Flutter version.' }
if (($flutterInfo | ConvertFrom-Json).frameworkVersion -notin @('3.44.2', '3.44.9')) {
  throw 'Use Flutter 3.44.2 or 3.44.9 (Dart 3.12.2). Pass -FlutterCommand with its flutter.bat path; newer SDKs require a coordinated toolchain migration.'
}

function Invoke-Check([string]$Directory, [string]$Command, [string[]]$CommandArguments) {
  Push-Location -LiteralPath (Join-Path $projectRoot $Directory)
  try {
    Write-Host "Checking $Directory : $Command $CommandArguments"
    & $Command @CommandArguments
    if ($LASTEXITCODE -ne 0) { throw "Check failed with exit code $LASTEXITCODE in $Directory" }
  } finally { Pop-Location }
}

Invoke-Check 'functions' 'npm.cmd' @('run', 'lint')
Invoke-Check 'functions' 'npm.cmd' @('test')
Invoke-Check 'admin_dashboard' 'npm.cmd' @('run', 'lint')
Invoke-Check 'admin_dashboard' 'npm.cmd' @('test')
Invoke-Check 'admin_dashboard' 'npm.cmd' @('run', 'build')
if (-not $NoPub) { Invoke-Check 'mobile_app/temple_procession_tracker_app' $FlutterCommand @('pub', 'get', '--enforce-lockfile') }
Invoke-Check 'mobile_app/temple_procession_tracker_app' $FlutterCommand @('analyze', '--no-pub')
Invoke-Check 'mobile_app/temple_procession_tracker_app' $FlutterCommand @('test', '--no-pub')
if ($Rules) { Invoke-Check 'functions' 'npm.cmd' @('run', 'test:rules') }
if ($Android) { Invoke-Check 'mobile_app/temple_procession_tracker_app' $FlutterCommand @('build', 'apk', '--debug', '--no-pub', '--target-platform', 'android-arm64') }
