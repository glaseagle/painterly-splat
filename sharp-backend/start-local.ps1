param([string]$Config = "$env:USERPROFILE\.cache\painterly-sharp\local-worker.json")
$ErrorActionPreference = 'Stop'
$workerConfig = Get-Content -Raw -LiteralPath $Config | ConvertFrom-Json
$workerRoot = Split-Path -Parent $Config
$workerPidFile = Join-Path $workerRoot 'local-worker.pid'
if (Test-Path -LiteralPath $workerPidFile) {
    $workerExisting = Get-CimInstance Win32_Process -Filter "ProcessId = $(Get-Content -LiteralPath $workerPidFile)"
    if ($workerExisting.CommandLine -like '*local-worker.py*') { Write-Output 'Local SHARP generator is already running.'; exit }
}
$workerScript = Join-Path $PSScriptRoot 'local-worker.py'
$workerProcess = Start-Process -FilePath $workerConfig.python -ArgumentList @('-u', ('"'+$workerScript+'"'), '--config', ('"'+$Config+'"')) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $workerRoot 'local-worker.log') -RedirectStandardError (Join-Path $workerRoot 'local-worker-errors.log')
$workerProcess.Id | Set-Content -LiteralPath $workerPidFile
Write-Output 'Local SHARP generator started. Keep this PC awake for photo generation.'
