param([string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$taskOut = Join-Path $taskRoot 'outputs\2026-10-15-Telegram聊天预览'
if ($OutputDirectory) {
    $taskOut = [IO.Path]::GetFullPath((Join-Path $taskRoot $OutputDirectory))
    $taskOutputRoot = [IO.Path]::GetFullPath((Join-Path $taskRoot 'outputs')) + '\'
    if (-not $taskOut.StartsWith($taskOutputRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Native build output must remain inside project outputs' }
}
[IO.Directory]::CreateDirectory($taskOut) | Out-Null
$taskSdk = Join-Path $taskRoot 'desktop\vendor\webview2'
$taskCompiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
foreach ($taskName in @('Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll','WebView2Loader.dll')) {
    Copy-Item -LiteralPath (Join-Path $taskSdk $taskName) -Destination (Join-Path $taskOut $taskName)
}
Copy-Item -LiteralPath (Join-Path $taskSdk 'LICENSE.txt') -Destination (Join-Path $taskOut 'WebView2-LICENSE.txt')
$taskInputSource = Get-Content -LiteralPath (Join-Path $taskRoot 'desktop\QuickHost.cs') -Raw -Encoding UTF8
$taskInputOffset = $taskInputSource.IndexOf('internal static class QuickInputMode')
if ($taskInputOffset -lt 0) { throw 'Shared input-mode helper is missing' }
$taskInputFile = Join-Path $taskRoot 'tmp\telegram-preview-20261015\SharedInputMode.cs'
Set-Content -LiteralPath $taskInputFile -Value ("using System;`nusing System.Drawing;`nusing System.Windows.Forms;`nusing System.Runtime.InteropServices;`n" + $taskInputSource.Substring($taskInputOffset)) -Encoding UTF8
& $taskCompiler /nologo /target:winexe /platform:x64 /reference:System.Web.Extensions.dll /reference:System.Windows.Forms.dll /reference:System.Drawing.dll ("/reference:" + (Join-Path $taskSdk 'Microsoft.Web.WebView2.Core.dll')) ("/reference:" + (Join-Path $taskSdk 'Microsoft.Web.WebView2.WinForms.dll')) ("/win32icon:" + (Join-Path $taskRoot 'public\icons\shiye-hd.ico')) ("/out:" + (Join-Path $taskOut '拾页对话预览.exe')) (Join-Path $PSScriptRoot 'DesktopPreview.cs') (Join-Path $PSScriptRoot 'ChatJournalBridge.cs') (Join-Path $PSScriptRoot 'EdgeDock.cs') (Join-Path $PSScriptRoot 'DisplayMemory.cs') (Join-Path $PSScriptRoot 'ImageViewer.cs') (Join-Path $PSScriptRoot 'ImageWindowMemory.cs') (Join-Path $PSScriptRoot 'WorkspaceLaunchers.cs') (Join-Path $taskRoot 'desktop\DesktopPaths.cs') $taskInputFile
if ($LASTEXITCODE -ne 0) { throw 'Preview host compilation failed' }
Write-Output 'Preview host compiled.'
