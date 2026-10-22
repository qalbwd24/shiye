$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
. 'D:\codex-tools\android-state\activate.ps1'
& 'D:\codex-tools\android-state\Start-ShiyeEmulator.ps1'
$adb = 'D:\codex-tools\android-sdk\platform-tools\adb.exe'
$started = [DateTime]::UtcNow
do {
    $boot = (& $adb -s emulator-5554 shell getprop sys.boot_completed 2>$null | Out-String).Trim()
    if ($boot -eq '1') { break }
    if (([DateTime]::UtcNow - $started).TotalSeconds -gt 180) { throw '模拟器尚未启动完成，请稍后重试。' }
    Start-Sleep -Seconds 1
} while ($true)
$installed = (& $adb -s emulator-5554 shell pm path dev.shiye.app | Out-String).Trim()
if (!$installed.StartsWith('package:')) {
    $apk = Join-Path $workspaceRoot 'tmp\android-dual-prototype\app-build\outputs\apk\debug\app-debug.apk'
    if (!(Test-Path -LiteralPath $apk)) { throw '请先按 android/README.md 构建样机。' }
    & $adb -s emulator-5554 install -r $apk
    if ($LASTEXITCODE -ne 0) { throw '样机安装失败。' }
}
& $adb -s emulator-5554 shell am start -W -n dev.shiye.app/.MainActivity
if ($LASTEXITCODE -ne 0) { throw '样机启动失败。' }
