param([switch]$Run, [switch]$Http, [ValidateSet('emulator-5580')][string]$Serial='emulator-5580', [string]$OutputRoot)
$ErrorActionPreference='Stop'
$workspaceRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$allowedOutput=[IO.Path]::GetFullPath((Join-Path $workspaceRoot 'outputs/2026-10-19-shared-business-integration'))
if(-not $OutputRoot){$OutputRoot=Join-Path $allowedOutput ('native-shared-'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ'))}
$outputRoot=[IO.Path]::GetFullPath($OutputRoot)
if(-not $outputRoot.StartsWith($allowedOutput+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'OutputRoot must be a new shared-conversation-directory evidence child.'}
if(Test-Path -LiteralPath $outputRoot){throw 'Prior evidence is never overwritten.'}
$projectRoot=Join-Path $workspaceRoot 'tmp/2026-10-19-shared-conversation-directory/native-probe'
$javaRoot=Join-Path $projectRoot 'src/main/java/dev/shiye/app'
$adbPath='D:/codex-tools/android-sdk/platform-tools/adb.exe'
$qaPackage='dev.shiye.syncqa021'
$serverProcess=$null;$reverseAdded=$false
if($Http -and -not $Run){throw 'HTTP requires explicit -Run.'}
Push-Location -LiteralPath $workspaceRoot
try {
    New-Item -ItemType Directory -Force $javaRoot,$outputRoot | Out-Null
    foreach($name in @('BackendServices','SharedBackendTransport','SharedBackendBridge','SharedSeedFile','SharedSeedBridge','SharedSeedImport')){Copy-Item -LiteralPath "android/app/src/main/java/dev/shiye/app/$name.java" -Destination $javaRoot}
    Copy-Item -LiteralPath android/sync-tests/SharedBackendProbe.java -Destination $javaRoot
    foreach($name in @('build.gradle','settings.gradle','gradle.properties')){Copy-Item -LiteralPath "android/sync-tests/harness/$name" -Destination $projectRoot}
    $manifest='<manifest xmlns:android="http://schemas.android.com/apk/res/android"><uses-permission android:name="android.permission.INTERNET"/><application android:label="Shiye Shared Backend QA" android:allowBackup="false" android:debuggable="true" android:usesCleartextTraffic="true"/><instrumentation android:name="dev.shiye.app.SharedBackendProbe" android:targetPackage="dev.shiye.syncqa021" android:functionalTest="true"/></manifest>'
    Set-Content -LiteralPath (Join-Path $projectRoot 'src/main/AndroidManifest.xml') -Value $manifest -Encoding UTF8
    . D:/codex-tools/android-state/activate.ps1
    & ./android/gradlew.bat -p $projectRoot assembleDebug --offline --console plain *> (Join-Path $outputRoot 'native-build.log')
    if($LASTEXITCODE -ne 0){throw 'Shared QA build failed.'}
    $sources=Get-ChildItem -LiteralPath $javaRoot -Filter '*.java' | ForEach-Object {[ordered]@{name=$_.Name;sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}}
    $sources | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $outputRoot 'native-sources.json') -Encoding UTF8
    if($Run){
        & $adbPath -s $Serial get-state
        if($LASTEXITCODE -ne 0){throw 'Dedicated QA emulator is unavailable; this runner does not start devices.'}
        $avd=(& $adbPath -s $Serial emu avd name | Select-Object -First 1).Trim()
        if($LASTEXITCODE -ne 0 -or $avd -ne 'Shiye_Emulator_Repair_QA'){throw 'Only the dedicated synthetic QA AVD is allowed.'}
        $boot=(& $adbPath -s $Serial shell getprop sys.boot_completed | Out-String).Trim()
        if($LASTEXITCODE -ne 0 -or $boot -ne '1'){throw 'Dedicated emulator has not completed boot; no QA install attempted.'}
        if($Http){
            if(Get-NetTCPConnection -LocalPort 19421 -State Listen -ErrorAction SilentlyContinue){throw 'Synthetic port occupied; no existing server stopped.'}
            $nodePath=(Get-Command node).Source
            $serverProcess=Start-Process -FilePath $nodePath -ArgumentList 'android/sync-tests/shared-server.mjs' -WorkingDirectory $workspaceRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $outputRoot 'qa-server.log') -RedirectStandardError (Join-Path $outputRoot 'qa-server-error.log')
            $deadline=[DateTime]::UtcNow.AddSeconds(25)
            do{$ready=Get-NetTCPConnection -LocalPort 19421 -State Listen -ErrorAction SilentlyContinue;if($serverProcess.HasExited){throw 'Owned synthetic shared service failed.'};if(-not $ready){Start-Sleep -Milliseconds 100}}until($ready -or [DateTime]::UtcNow -gt $deadline)
            if(-not $ready -or $ready.OwningProcess -ne $serverProcess.Id){throw 'Synthetic service identity mismatch.'}
            $reverses=(& $adbPath -s $Serial reverse --list | Out-String)
            if($reverses -match 'tcp:19421'){throw 'Existing QA reverse not taken over.'}
            & $adbPath -s $Serial reverse tcp:19421 tcp:19421
            if($LASTEXITCODE -ne 0){throw 'Dedicated QA reverse failed.'};$reverseAdded=$true
        }
        $apk=Join-Path $projectRoot 'build/outputs/apk/debug/ShiyeSyncQa021-debug.apk'
        $hash=(Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash.ToLowerInvariant()
        $installed=(& $adbPath -s $Serial shell pm path $qaPackage | Select-Object -First 1)
        $reuse=$false
        if($installed -match '^package:(/data/app/[A-Za-z0-9_~+=./-]+/base\.apk)$'){$remote=$Matches[1];$remoteHash=(& $adbPath -s $Serial shell sha256sum $remote | Out-String).Trim().Split(' ')[0].ToLowerInvariant();$reuse=$LASTEXITCODE -eq 0 -and $remoteHash -eq $hash}
        if(-not $reuse){& $adbPath -s $Serial install -r $apk;if($LASTEXITCODE -ne 0){throw 'Single QA installation failed; no automatic retry.'}}
        [ordered]@{device=$Serial;avd=$avd;sha256=$hash;installationSkipped=$reuse;automaticInstallRetry=$false;physicalDeviceAllowed=$false;servicesStarted=[int]$Http.IsPresent;networkTested=$Http.IsPresent;frontendPackageTouched=$false} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $outputRoot 'qa-install.json') -Encoding UTF8
        if($Http){& $adbPath -s $Serial shell am instrument -e http true -w "$qaPackage/dev.shiye.app.SharedBackendProbe" *> (Join-Path $outputRoot 'native-shared.log')}
        else{& $adbPath -s $Serial shell am instrument -w "$qaPackage/dev.shiye.app.SharedBackendProbe" *> (Join-Path $outputRoot 'native-shared.log')}
        if($LASTEXITCODE -ne 0){throw 'Shared instrumentation failed.'}
        $answer=(& $adbPath -s $Serial exec-out run-as $qaPackage cat files/shared-result.json | Out-String)
        if($LASTEXITCODE -ne 0){throw 'Shared result unavailable.'}
        $answer | Set-Content -LiteralPath (Join-Path $outputRoot 'native-shared-result.json') -Encoding UTF8
        $parsed=$answer | ConvertFrom-Json
        if(-not $parsed.ok){throw "Shared probe failed: $($parsed.failure)"}
        Write-Output "SharedBackendProbe: $($parsed.checks.Count) actual Android assertions passed."
    }
    Write-Output "Shared QA evidence: $outputRoot"
}finally{
    if($reverseAdded){& $adbPath -s $Serial reverse --remove tcp:19421}
    if($serverProcess -and -not $serverProcess.HasExited){Stop-Process -Id $serverProcess.Id}
    Pop-Location
}
