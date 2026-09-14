# Explicit local upgrade. Run only after saving all diary editors.
$ErrorActionPreference = 'Stop'
$releaseRoot = [IO.Path]::GetFullPath('F:\我的奋斗\日记软件本地化\电脑前端')
$sourceRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$releaseEntry = Join-Path $releaseRoot 'server.mjs'
$nodeFile = 'D:\软件\Apps\NodeJS\node-v24.18.1-win-x64\node.exe'
$expectedVersion = '0.5.0'
Push-Location $releaseRoot
try {
    if ((git status --porcelain | Out-String).Trim()) { throw 'Formal checkout has uncommitted source changes. Nothing was stopped.' }
    $revision = (git rev-parse --verify codex/desktop-v0.5).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'Validated development branch was not found.' }
    $package = git show ($revision + ':package.json') | ConvertFrom-Json
    if ($package.version -ne $expectedVersion) { throw 'Unexpected source version.' }
    $launcherSource = Join-Path $sourceRoot '拾页日记.exe'
    if (!(Test-Path -LiteralPath $launcherSource) -or !(Test-Path -LiteralPath $nodeFile)) { throw 'Launcher or Node runtime missing.' }
    $listeners = @(Get-NetTCPConnection -LocalPort 18765 -State Listen -ErrorAction SilentlyContinue)
    foreach ($listener in $listeners) {
        $process = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $listener.OwningProcess)
        if ($process.Name -ne 'node.exe' -or !$process.CommandLine.Contains($releaseEntry)) { throw 'Unrecognized listener. Nothing was stopped.' }
    }
    foreach ($listener in $listeners) { Stop-Process -Id $listener.OwningProcess -ErrorAction Stop }
    try {
        $snapshot = Join-Path 'F:\我的奋斗\迁移记录' ('升级0.5.0-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
        New-Item -ItemType Directory -Path $snapshot | Out-Null
        Copy-Item -LiteralPath (Join-Path $releaseRoot 'data\diary.json') -Destination (Join-Path $snapshot 'diary-before.json')
        $branch = 'codex/release-v0.5-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
        git switch -c $branch $revision
        if ($LASTEXITCODE -ne 0) { throw 'Could not switch source. Data snapshot is retained.' }
        Copy-Item -LiteralPath $launcherSource -Destination (Join-Path $releaseRoot '拾页日记.exe') -Force
    } finally {
        # Start whichever source is checked out, even if source switching failed.
        Start-Process -FilePath $nodeFile -ArgumentList ('"' + $releaseEntry + '"') -WorkingDirectory $releaseRoot -WindowStyle Hidden | Out-Null
    }
    $healthy = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        try {
            $health = Invoke-RestMethod 'http://127.0.0.1:18765/api/health' -TimeoutSec 2
            if ($health.version -eq $expectedVersion) { $healthy = $true; break }
        } catch { }
        Start-Sleep -Milliseconds 250
    }
    if (!$healthy) { throw 'The running version could not be verified.' }
    Write-Output ('Ready: ' + $expectedVersion)
    Write-Output ('Data snapshot: ' + $snapshot)
} finally { Pop-Location }
