param([Parameter(Mandatory=$true)][string]$Serial, [ValidateSet('all','seed')][string]$Probe = 'all')
$ErrorActionPreference = 'Stop'
if ($Serial -notmatch '^emulator-\d+$') { throw 'QA installation is restricted to an explicitly named emulator. Physical phones are never installed by this script.' }
$workspaceRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$projectRoot = Join-Path $workspaceRoot 'tmp/android-sync021/probe'
$outputRoot = Join-Path $workspaceRoot 'outputs/2026-10-19-backend-data-completion'
$javaRoot = Join-Path $projectRoot 'src/main/java/dev/shiye/app'
$assetRoot = Join-Path $projectRoot 'src/main/assets'
$qaPackage = 'dev.shiye.syncqa021'
$adbPath = 'D:/codex-tools/android-sdk/platform-tools/adb.exe'
$serverProcess = $null
$reverseAdded = $false
Push-Location -LiteralPath $workspaceRoot
try {
    if (Get-NetTCPConnection -LocalPort 19421 -State Listen -ErrorAction SilentlyContinue) { throw 'Synthetic port 19421 is occupied; no existing server was stopped.' }
    & $adbPath -s $Serial get-state
    if ($LASTEXITCODE -ne 0) { throw 'Explicit test device unavailable.' }
    $qaAvdName = (& $adbPath -s $Serial emu avd name | Select-Object -First 1).Trim()
    if ($LASTEXITCODE -ne 0 -or $qaAvdName -ne 'Shiye_Emulator_Repair_QA') { throw 'Only the dedicated synthetic QA AVD may receive this test package; user AVDs are excluded.' }
    New-Item -ItemType Directory -Force -Path $javaRoot,$assetRoot,$outputRoot | Out-Null
    foreach ($name in @('ProductRepository','ProductDiaryStore','ProductPayloadReader','ProductPayloadWriter','ProductChatStore','ProductMediaBridge','ProductOriginals','ProductUiBridge','ProductSyncCoordinator','AndroidSyncTransport','SyncCredentials','ProductRetryPolicy','ProductLocalSelection','ProductDownloadQueue','ProductSeedFile','ProductSeedInstaller')) {
        Copy-Item -LiteralPath "android/app/src/main/java/dev/shiye/app/$name.java" -Destination (Join-Path $javaRoot "$name.java")
    }
    foreach ($name in @('MainActivity','LocalStore')) { Copy-Item -LiteralPath "android/sync-tests/harness/$name.java" -Destination (Join-Path $javaRoot "$name.java") }
    foreach ($name in @('SyncIntegrationProbe','SeedBackendProbe')) { Copy-Item -LiteralPath "android/sync-tests/$name.java" -Destination (Join-Path $javaRoot "$name.java") }
    foreach ($name in @('build.gradle','settings.gradle','gradle.properties')) { Copy-Item -LiteralPath "android/sync-tests/harness/$name" -Destination (Join-Path $projectRoot $name) }
    Copy-Item -LiteralPath 'android/sync-tests/harness/AndroidManifest.xml' -Destination (Join-Path $projectRoot 'src/main/AndroidManifest.xml')
    Copy-Item -LiteralPath 'docs/contracts/product-seed-v1.fixture.json' -Destination (Join-Path $assetRoot 'seed-golden.json')
    $startedAt = [DateTime]::UtcNow
    $nodePath = (Get-Command node).Source
    $serverProcess = Start-Process -FilePath $nodePath -ArgumentList 'android/sync-tests/server.mjs' -WorkingDirectory $workspaceRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $outputRoot 'qa-server.log') -RedirectStandardError (Join-Path $outputRoot 'qa-server-error.log')
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    do {
        $ready = Get-NetTCPConnection -LocalPort 19421 -State Listen -ErrorAction SilentlyContinue
        if ($serverProcess.HasExited) { throw 'Synthetic server failed.' }
        if (-not $ready) { Start-Sleep -Milliseconds 100 }
    } until ($ready -or [DateTime]::UtcNow -gt $deadline)
    if (-not $ready -or $ready.OwningProcess -ne $serverProcess.Id) { throw 'Synthetic server identity mismatch.' }
    if ((Get-Item -LiteralPath (Join-Path $assetRoot 'fixture.json')).LastWriteTimeUtc -lt $startedAt) { throw 'Stale synthetic pairing fixture.' }
    . 'D:/codex-tools/android-state/activate.ps1'
    & ./android/gradlew.bat -p $projectRoot assembleDebug --offline --console plain > (Join-Path $outputRoot 'native-build.log') 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'Native backend compilation failed.' }
    $qaApk = Join-Path $projectRoot 'build/outputs/apk/debug/ShiyeSyncQa021-debug.apk'
    $qaHash = (Get-FileHash -LiteralPath $qaApk -Algorithm SHA256).Hash.ToLowerInvariant()
    $installedLine = (& $adbPath -s $Serial shell pm path $qaPackage | Select-Object -First 1)
    $reuseQa = $false
    if ($installedLine -match '^package:(/data/app/[A-Za-z0-9_~+=./-]+/base\.apk)$') {
        $remoteApk = $Matches[1]
        $remoteHash = (& $adbPath -s $Serial shell sha256sum $remoteApk | Out-String).Trim().Split(' ')[0].ToLowerInvariant()
        $reuseQa = $LASTEXITCODE -eq 0 -and $remoteHash -eq $qaHash
    }
    if (-not $reuseQa) {
        & $adbPath -s $Serial install -r $qaApk
        if ($LASTEXITCODE -ne 0) { throw 'Isolated QA installation failed.' }
    } else { Write-Output 'Verified identical QA APK; installation skipped.' }
    [ordered]@{ device=$Serial; avd=$qaAvdName; sha256=$qaHash; installationSkipped=$reuseQa; physicalDeviceAllowed=$false; automaticInstallRetry=$false } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $outputRoot 'qa-install.json') -Encoding UTF8
    & $adbPath -s $Serial reverse tcp:19421 tcp:19421
    if ($LASTEXITCODE -ne 0) { throw 'QA reverse failed.' }
    $reverseAdded = $true
    $probes = @(@('SyncIntegrationProbe','result.json','native-sync'),@('SeedBackendProbe','seed-result.json','native-seed'))
    if ($Probe -eq 'seed') { $probes = ,@('SeedBackendProbe','seed-result.json','native-seed') }
    foreach ($probeSpec in $probes) {
        & $adbPath -s $Serial shell am instrument -w "$qaPackage/dev.shiye.app.$($probeSpec[0])" > (Join-Path $outputRoot "$($probeSpec[2]).log") 2>&1
        if ($LASTEXITCODE -ne 0) { throw 'Native instrumentation failed.' }
        $result = (& $adbPath -s $Serial exec-out run-as $qaPackage cat "files/$($probeSpec[1])" | Out-String)
        if ($LASTEXITCODE -ne 0) { throw 'QA result unavailable.' }
        $result | Set-Content -LiteralPath (Join-Path $outputRoot "$($probeSpec[2])-result.json") -Encoding UTF8
        $parsed = $result | ConvertFrom-Json
        if (-not $parsed.ok) { throw "Native backend failure: $($parsed.failure)" }
        Write-Output "$($probeSpec[0]): $($parsed.checks.Count) checks passed in isolated Android UID."
    }
    $sources = Get-ChildItem -LiteralPath $javaRoot -Filter '*.java' | ForEach-Object { [ordered]@{ name=$_.Name; sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() } }
    [ordered]@{ actualAndroid=$true; synthetic=$true; package=$qaPackage; device=$Serial; frontendPackageTouched=$false; files=$sources } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $outputRoot 'native-sources.json') -Encoding UTF8
} finally {
    if ($reverseAdded) { & $adbPath -s $Serial reverse --remove tcp:19421 }
    if ($serverProcess -and -not $serverProcess.HasExited) { Stop-Process -Id $serverProcess.Id }
    Pop-Location
}
