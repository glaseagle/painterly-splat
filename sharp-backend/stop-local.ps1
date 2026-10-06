param([string]$Config = "$env:USERPROFILE\.cache\painterly-sharp\local-worker.json")
$workerPidFile = Join-Path (Split-Path -Parent $Config) 'local-worker.pid'
if (Test-Path -LiteralPath $workerPidFile) {
    $workerProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $(Get-Content -LiteralPath $workerPidFile)"
    if ($workerProcess.CommandLine -like '*local-worker.py*') {
        # Include Python's virtual-environment launcher and the owned inference child.
        & taskkill.exe /PID $workerProcess.ProcessId /T /F | Out-Null
    }
    Remove-Item -LiteralPath $workerPidFile
}
$workerJobsRoot = Join-Path (Split-Path -Parent $Config) 'jobs'
if (Test-Path -LiteralPath $workerJobsRoot) {
    $workerResolvedRoot = (Resolve-Path -LiteralPath $workerJobsRoot).Path
    Get-ChildItem -LiteralPath $workerResolvedRoot -Directory -Filter 'job-*' | ForEach-Object {
        $workerJobPath = (Resolve-Path -LiteralPath $_.FullName).Path
        if ([IO.Path]::GetDirectoryName($workerJobPath) -eq $workerResolvedRoot -and -not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            Remove-Item -LiteralPath $workerJobPath -Recurse -Force
        }
    }
}
Write-Output 'Local generator stopped. The website will show offline within 90 seconds.'
