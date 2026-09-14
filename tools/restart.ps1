# Save pending edits before running. This script only targets this project's local listener.
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$taskConfig = Get-Content -LiteralPath (Join-Path $taskRoot 'config\app.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$taskEntry = Join-Path $taskRoot 'server.mjs'
$taskListeners = @(Get-NetTCPConnection -State Listen -LocalPort $taskConfig.port -ErrorAction SilentlyContinue | Where-Object LocalAddress -eq '127.0.0.1')
foreach ($taskListener in $taskListeners) {
    $taskProcess = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $taskListener.OwningProcess)
    if ($taskProcess.Name -ne 'node.exe' -or !$taskProcess.CommandLine.Contains($taskEntry)) {
        throw 'The port belongs to an unrecognized process. No process was stopped.'
    }
    Stop-Process -Id $taskListener.OwningProcess -ErrorAction Stop
}
$taskLauncher = Start-Process -FilePath (Join-Path $taskRoot '拾页日记.exe') -ArgumentList '--check' -WorkingDirectory $taskRoot -WindowStyle Hidden -Wait -PassThru
if ($taskLauncher.ExitCode -ne 0) { throw 'Launcher failed. Check the application directory.' }
$taskHealth = Invoke-RestMethod ('http://127.0.0.1:' + $taskConfig.port + '/api/health')
$taskVersion = (Get-Content -LiteralPath (Join-Path $taskRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
if ($taskHealth.version -ne $taskVersion) { throw 'Running version does not match the source.' }
Write-Output ('Ready: ' + $taskHealth.version)
