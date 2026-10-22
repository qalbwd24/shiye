# Thin local CLI wrapper; forwards only to the checked command parser, without elevation.
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskNodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$taskNode = if ($taskNodeCommand) { $taskNodeCommand.Source } else { 'D:\软件\Apps\NodeJS\node-v24.18.1-win-x64\node.exe' }
if (!(Test-Path -LiteralPath $taskNode)) { throw '找不到 Node.js；请先配置 Node.js 的 PATH。' }
& $taskNode (Join-Path $PSScriptRoot 'desktop-control.mjs') @args
exit $LASTEXITCODE
