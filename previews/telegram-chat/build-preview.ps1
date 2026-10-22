param([string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$taskOut = Join-Path $taskRoot 'outputs\2026-10-15-Telegram聊天预览'
if ($OutputDirectory) {
    $taskOut = [IO.Path]::GetFullPath((Join-Path $taskRoot $OutputDirectory))
    $taskOutputRoot = [IO.Path]::GetFullPath((Join-Path $taskRoot 'outputs')) + '\'
    if (-not $taskOut.StartsWith($taskOutputRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Preview build output must remain inside project outputs' }
}
[IO.Directory]::CreateDirectory($taskOut) | Out-Null
$taskApp = [IO.Path]::GetFullPath((Join-Path $taskOut 'app'))
if (-not $taskApp.StartsWith($taskOut + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid preview output' }
$taskNode = 'D:\软件\Apps\NodeJS\node-v24.18.1-win-x64\node.exe'
$env:PATH = [IO.Path]::GetDirectoryName($taskNode) + ';' + $env:PATH
& $taskNode (Join-Path $PSScriptRoot 'prepare-preview.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Preview preparation failed' }
$env:APP_ENV = 'test'
$env:APP_MOCKED_CLIENT = '1'
$env:APP_TITLE = '拾页 · 随想'
$env:APP_NAME = '拾页'
$env:BASE_URL = 'https://shiye-preview.local/'
$env:HEAD = '090e38f1dffec3e0a9aefbec8159a9931fbeec8f'
Push-Location (Join-Path $PSScriptRoot 'vendor\web-a')
try {
    # Windows PowerShell treats native stderr warnings as terminating errors
    # under Stop; use the native exit code to decide whether Vite failed.
    $ErrorActionPreference = 'Continue'
    & $taskNode 'node_modules/vite/bin/vite.js' build --mode development --outDir $taskApp --emptyOutDir *> (Join-Path $taskOut 'build.log')
    $ErrorActionPreference = 'Stop'
    if ($LASTEXITCODE -ne 0) { throw 'Preview build failed; see build.log' }
} finally { $ErrorActionPreference = 'Stop'; Pop-Location }
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'vendor\web-a\LICENSE') -Destination (Join-Path $taskOut 'Telegram-Web-A-LICENSE')
& $taskNode (Join-Path $PSScriptRoot 'write-manifest.mjs') $taskOut
if ($LASTEXITCODE -ne 0) { throw 'Source manifest failed' }
Write-Output 'Built local-only preview assets.'
