$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskEntry = Join-Path $taskRoot '拾页聊天.exe'
$taskCompiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$taskOutput = Join-Path $taskRoot 'outputs\2026-10-15-自定义表情映射与F15'
New-Item -ItemType Directory -Force $taskOutput | Out-Null
if (Test-Path -LiteralPath $taskEntry) {
    $taskHash = (Get-FileHash -LiteralPath $taskEntry -Algorithm SHA256).Hash
    Copy-Item -LiteralPath $taskEntry -Destination (Join-Path $taskOutput ('entry-before-' + $taskHash + '.exe'))
}
& $taskCompiler /nologo /target:winexe /platform:x64 /reference:System.Windows.Forms.dll ("/win32icon:" + (Join-Path $taskRoot 'public\icons\shiye-hd.ico')) ("/out:" + $taskEntry) (Join-Path $taskRoot 'desktop\ChatEntry.cs')
if ($LASTEXITCODE -ne 0) { throw 'Chat entry compilation failed' }
$taskPrograms = [Environment]::GetFolderPath('Programs')
$taskShortcutDir = Join-Path $taskPrograms '拾页'
New-Item -ItemType Directory -Force $taskShortcutDir | Out-Null
$taskShortcutPath = Join-Path $taskShortcutDir '拾页聊天.lnk'
if (Test-Path -LiteralPath $taskShortcutPath) {
    $taskHash = (Get-FileHash -LiteralPath $taskShortcutPath -Algorithm SHA256).Hash
    Copy-Item -LiteralPath $taskShortcutPath -Destination (Join-Path $taskOutput ('shortcut-before-' + $taskHash + '.lnk'))
}
$taskShell = New-Object -ComObject WScript.Shell
$taskShortcut = $taskShell.CreateShortcut($taskShortcutPath)
$taskShortcut.TargetPath = $taskEntry
$taskShortcut.WorkingDirectory = $taskRoot
$taskShortcut.IconLocation = Join-Path $taskRoot 'public\icons\shiye-hd.ico'
$taskShortcut.Description = '拾页聊天：本地随记，F15 唤回并聚焦输入'
$taskShortcut.Save()
@{ entry = $taskEntry; entrySha256 = (Get-FileHash -LiteralPath $taskEntry -Algorithm SHA256).Hash; shortcut = $taskShortcutPath; target = $taskShortcut.TargetPath } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskOutput 'entry-install.json') -Encoding UTF8
Write-Output 'Chat EXE and Start Menu entry installed.'
