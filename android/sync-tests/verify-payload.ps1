param([ValidateSet('emulator-5580')][string]$Serial='emulator-5580', [string]$OutputRoot, [switch]$Http)
$ErrorActionPreference='Stop'
$workspaceRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$allowedOutput=[IO.Path]::GetFullPath((Join-Path $workspaceRoot 'outputs/2026-10-19-backend-source-snapshots'))
if(-not $OutputRoot){$OutputRoot=Join-Path $allowedOutput ('payload-qa-'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ'))}
$outputRoot=[IO.Path]::GetFullPath($OutputRoot)
if(-not $outputRoot.StartsWith($allowedOutput+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'OutputRoot must be a new child of outputs/2026-10-19-backend-source-snapshots.'}
if(Test-Path -LiteralPath $outputRoot){throw 'OutputRoot already exists; prior evidence is never overwritten.'}
$projectRoot=Join-Path $workspaceRoot 'tmp/backend-source-snapshots/payload-qa'
$javaRoot=Join-Path $projectRoot 'src/main/java/dev/shiye/app'
$assetRoot=Join-Path $projectRoot 'src/main/assets'
$adbPath='D:/codex-tools/android-sdk/platform-tools/adb.exe'
$qaPackage='dev.shiye.syncqa021'
$serverProcess=$null;$reverseAdded=$false;$savedEnvironment=@{}
Push-Location -LiteralPath $workspaceRoot
try{
    # HTTP is opt-in and owns only its fresh synthetic service plus dedicated AVD reverse.
    & $adbPath -s $Serial get-state
    if($LASTEXITCODE -ne 0){throw 'Dedicated QA emulator is unavailable.'}
    $avd=(& $adbPath -s $Serial emu avd name | Select-Object -First 1).Trim()
    if($LASTEXITCODE -ne 0 -or $avd -ne 'Shiye_Emulator_Repair_QA'){throw 'Dedicated backend AVD identity mismatch.'}
    New-Item -ItemType Directory -Force -Path $javaRoot,$assetRoot,$outputRoot | Out-Null
    $backend=@('ProductRepository','ProductDiaryStore','ProductPayloadReader','ProductPayloadWriter','ProductChatStore','ProductMediaBridge','ProductOriginals','ProductUiBridge','ProductSyncCoordinator','AndroidSyncTransport','SyncCredentials','ProductRetryPolicy','ProductLocalSelection','ProductDownloadQueue','ProductSeedFile','ProductSeedInstaller')
    foreach($name in $backend){Copy-Item -LiteralPath "android/app/src/main/java/dev/shiye/app/$name.java" -Destination (Join-Path $javaRoot "$name.java")}
    foreach($name in @('MainActivity','LocalStore')){Copy-Item -LiteralPath "android/sync-tests/harness/$name.java" -Destination (Join-Path $javaRoot "$name.java")}
    Copy-Item -LiteralPath 'android/sync-tests/PayloadBackendProbe.java' -Destination (Join-Path $javaRoot 'PayloadBackendProbe.java')
    foreach($name in @('build.gradle','settings.gradle','gradle.properties')){Copy-Item -LiteralPath "android/sync-tests/harness/$name" -Destination (Join-Path $projectRoot $name)}
    $manifest='<manifest xmlns:android="http://schemas.android.com/apk/res/android"><uses-permission android:name="android.permission.INTERNET"/><application android:label="Shiye Payload Backend QA" android:allowBackup="false" android:debuggable="true" android:usesCleartextTraffic="true"/><instrumentation android:name="dev.shiye.app.PayloadBackendProbe" android:targetPackage="dev.shiye.syncqa021" android:functionalTest="true"/></manifest>'
    [IO.File]::WriteAllText((Join-Path $projectRoot 'src/main/AndroidManifest.xml'),$manifest,[Text.UTF8Encoding]::new($false))
    Copy-Item -LiteralPath 'docs/contracts/product-seed-v1.fixture.json' -Destination (Join-Path $assetRoot 'seed-golden.json')
    if($Http){
        if(Get-NetTCPConnection -LocalPort 19421 -State Listen -ErrorAction SilentlyContinue){throw 'Synthetic port 19421 is occupied; no existing process was stopped.'}
        foreach($name in @('SHIYE_SYNC_QA_WORK_ROOT','SHIYE_SYNC_QA_OUTPUT_ROOT','SHIYE_SYNC_QA_FIXTURE_FILE','SHIYE_SYNC_QA_DISABLE_PC_EDIT')){$savedEnvironment[$name]=[Environment]::GetEnvironmentVariable($name,'Process')}
        $env:SHIYE_SYNC_QA_WORK_ROOT=Join-Path $workspaceRoot 'tmp/backend-source-snapshots/payload-http-network'
        $env:SHIYE_SYNC_QA_OUTPUT_ROOT=$outputRoot
        $env:SHIYE_SYNC_QA_FIXTURE_FILE=Join-Path $assetRoot 'fixture.json'
        $env:SHIYE_SYNC_QA_DISABLE_PC_EDIT='1'
        $serverSources=@('android/sync-tests/server.mjs','src/server/sync-product/service.mjs','src/server/sync-v2/store.mjs') | ForEach-Object {[ordered]@{path=$_;sha256=(Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash.ToLowerInvariant()}}
        $serverSources | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $outputRoot 'server-sources-start.json') -Encoding UTF8
        $serverStarted=[DateTime]::UtcNow
        $serverProcess=Start-Process -FilePath (Get-Command node).Source -ArgumentList 'android/sync-tests/server.mjs' -WorkingDirectory $workspaceRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $outputRoot 'qa-server.log') -RedirectStandardError (Join-Path $outputRoot 'qa-server-error.log')
        $deadline=[DateTime]::UtcNow.AddSeconds(30)
        do{$ready=Get-NetTCPConnection -LocalPort 19421 -State Listen -ErrorAction SilentlyContinue;if($serverProcess.HasExited){throw 'Owned synthetic HTTP server failed.'};if(-not $ready){Start-Sleep -Milliseconds 100}}until($ready -or [DateTime]::UtcNow -gt $deadline)
        if(-not $ready -or $ready.OwningProcess -ne $serverProcess.Id){throw 'Synthetic server ownership mismatch.'}
        if((Get-Item -LiteralPath (Join-Path $assetRoot 'fixture.json')).LastWriteTimeUtc -lt $serverStarted){throw 'Stale HTTP fixture.'}
    }
    . 'D:/codex-tools/android-state/activate.ps1'
    & ./android/gradlew.bat -p $projectRoot assembleDebug --offline --console plain *> (Join-Path $outputRoot 'native-build.log')
    if($LASTEXITCODE -ne 0){throw 'Payload QA compilation failed.'}
    $apk=Join-Path $projectRoot 'build/outputs/apk/debug/ShiyeSyncQa021-debug.apk'
    $hash=(Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash.ToLowerInvariant()
    $installed=(& $adbPath -s $Serial shell pm path $qaPackage | Select-Object -First 1)
    $reuse=$false
    if($installed -match '^package:(/data/app/[A-Za-z0-9_~+=./-]+/base\.apk)$'){$remote=$Matches[1];$remoteHash=(& $adbPath -s $Serial shell sha256sum $remote | Out-String).Trim().Split(' ')[0].ToLowerInvariant();$reuse=$LASTEXITCODE -eq 0 -and $remoteHash -eq $hash}
    if(-not $reuse){& $adbPath -s $Serial install -r $apk;if($LASTEXITCODE -ne 0){throw 'Single QA install failed; no automatic retry.'}}
    [ordered]@{device=$Serial;avd=$avd;sha256=$hash;installationSkipped=$reuse;automaticInstallRetry=$false;physicalDeviceAllowed=$false;servicesStarted=[int]$Http.IsPresent;frontendPackageTouched=$false} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $outputRoot 'qa-install.json') -Encoding UTF8
    if($Http){
        $existingReverse=(& $adbPath -s $Serial reverse --list | Out-String)
        if($existingReverse -match 'tcp:19421'){throw 'QA reverse 19421 already exists; not taking ownership.'}
        & $adbPath -s $Serial reverse tcp:19421 tcp:19421
        if($LASTEXITCODE -ne 0){throw 'Dedicated QA reverse failed.'};$reverseAdded=$true
        & $adbPath -s $Serial shell am instrument -e http true -w "$qaPackage/dev.shiye.app.PayloadBackendProbe" *> (Join-Path $outputRoot 'native-payload.log')
    }else{& $adbPath -s $Serial shell am instrument -w "$qaPackage/dev.shiye.app.PayloadBackendProbe" *> (Join-Path $outputRoot 'native-payload.log')}
    if($LASTEXITCODE -ne 0){throw 'Payload instrumentation failed.'}
    $answer=(& $adbPath -s $Serial exec-out run-as $qaPackage cat files/payload-result.json | Out-String)
    if($LASTEXITCODE -ne 0){throw 'Payload result unavailable.'}
    $answer | Set-Content -LiteralPath (Join-Path $outputRoot 'native-payload-result.json') -Encoding UTF8
    $sources=Get-ChildItem -LiteralPath $javaRoot -Filter '*.java' | ForEach-Object {[ordered]@{name=$_.Name;sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}}
    [ordered]@{actualAndroid=$true;synthetic=$true;device=$Serial;files=$sources;networkTested=$Http.IsPresent;frontendPackageTouched=$false} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $outputRoot 'native-sources.json') -Encoding UTF8
    $parsed=$answer | ConvertFrom-Json
    if(-not $parsed.ok){throw "Payload backend failed: $($parsed.failure)"}
    Write-Output "PayloadBackendProbe: $($parsed.checks.Count) real Android assertions passed. Evidence: $outputRoot"
}finally{
    if($reverseAdded){& $adbPath -s $Serial reverse --remove tcp:19421}
    if($serverProcess -and -not $serverProcess.HasExited){Stop-Process -Id $serverProcess.Id}
    foreach($name in $savedEnvironment.Keys){[Environment]::SetEnvironmentVariable($name,$savedEnvironment[$name],'Process')}
    Pop-Location
}
