param([string]$Serial = 'emulator-5554')
$ErrorActionPreference = 'Stop'
if ($Serial -notmatch '^emulator-\d+$') { throw 'Repository QA only supports an explicitly named emulator.' }
$workspaceRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$taskRoot = Join-Path $workspaceRoot 'tmp/android-product-017/repository'
$outputRoot = Join-Path $workspaceRoot 'outputs/2026-10-18-android-product-017/repository'
$projectRoot = Join-Path $taskRoot 'probe-project'
$javaRoot = Join-Path $projectRoot 'src/main/java/dev/shiye/app'
$assetRoot = Join-Path $projectRoot 'src/main/assets'
New-Item -ItemType Directory -Force -Path $javaRoot,$assetRoot,$outputRoot | Out-Null
. 'D:/codex-tools/android-state/activate.ps1'
Push-Location -LiteralPath $workspaceRoot
try {
    & node android/repository-tests/generate-reference.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Shared state machine oracle failed.' }
    Copy-Item -LiteralPath 'android/app/src/main/java/dev/shiye/app/ProductRepository.java' -Destination (Join-Path $javaRoot 'ProductRepository.java')
    Copy-Item -LiteralPath 'android/app/src/main/java/dev/shiye/app/ProductDownloadQueue.java' -Destination (Join-Path $javaRoot 'ProductDownloadQueue.java')
    Copy-Item -LiteralPath 'android/repository-tests/ProductRepositoryProbe.java' -Destination (Join-Path $javaRoot 'ProductRepositoryProbe.java')
    Copy-Item -LiteralPath 'docs/contracts/android-product-sync-v1.fixture.json' -Destination (Join-Path $assetRoot 'fixture.json')
    Copy-Item -LiteralPath (Join-Path $taskRoot 'reference.json') -Destination (Join-Path $assetRoot 'reference.json')
    @'
pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }
dependencyResolutionManagement { repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS); repositories { google(); mavenCentral() } }
rootProject.name = 'ShiyeRepositoryQa017'
'@ | Set-Content -LiteralPath (Join-Path $projectRoot 'settings.gradle') -Encoding UTF8
    @'
plugins { id 'com.android.application' version '8.13.2' }
android {
    namespace 'dev.shiye.repositoryqa017'
    compileSdk 36
    buildToolsVersion '36.0.0'
    defaultConfig { applicationId 'dev.shiye.repositoryqa017'; minSdk 26; targetSdk 35; versionCode 1; versionName 'synthetic-repository-017' }
    compileOptions { sourceCompatibility JavaVersion.VERSION_1_8; targetCompatibility JavaVersion.VERSION_1_8 }
    signingConfigs { debug { storeFile file('D:/codex-tools/android-state/keys/shiye-prototype-debug.jks'); storePassword 'android'; keyAlias 'androiddebugkey'; keyPassword 'android' } }
}
'@ | Set-Content -LiteralPath (Join-Path $projectRoot 'build.gradle') -Encoding UTF8
    "org.gradle.jvmargs=-Xmx1024m -Dfile.encoding=UTF-8`norg.gradle.daemon=false`nandroid.overridePathCheck=true" | Set-Content -LiteralPath (Join-Path $projectRoot 'gradle.properties') -Encoding UTF8
    @'
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
<application android:label="Shiye Repository synthetic QA" android:allowBackup="false" android:debuggable="true" />
<instrumentation android:name="dev.shiye.app.ProductRepositoryProbe" android:targetPackage="dev.shiye.repositoryqa017" android:functionalTest="true" />
</manifest>
'@ | Set-Content -LiteralPath (Join-Path $projectRoot 'src/main/AndroidManifest.xml') -Encoding UTF8
    & (Join-Path $workspaceRoot 'android/gradlew.bat') -p $projectRoot assembleDebug --console plain 2>&1 | Tee-Object -FilePath (Join-Path $outputRoot 'build.log')
    if ($LASTEXITCODE -ne 0) { throw 'Repository QA APK build failed.' }
    $adbPath = 'D:/codex-tools/android-sdk/platform-tools/adb.exe'
    & $adbPath -s $Serial install -r (Join-Path $projectRoot 'build/outputs/apk/debug/ShiyeRepositoryQa017-debug.apk')
    if ($LASTEXITCODE -ne 0) { throw 'Repository QA install failed.' }
    & $adbPath -s $Serial shell am instrument -w dev.shiye.repositoryqa017/dev.shiye.app.ProductRepositoryProbe 2>&1 | Tee-Object -FilePath (Join-Path $outputRoot 'instrumentation.log')
    if ($LASTEXITCODE -ne 0) { throw 'Repository instrumentation failed.' }
    $report = (& $adbPath -s $Serial exec-out run-as dev.shiye.repositoryqa017 cat files/repository-result.json | Out-String)
    if ($LASTEXITCODE -ne 0) { throw 'Repository QA report read failed.' }
    $report | Set-Content -LiteralPath (Join-Path $outputRoot 'android-sqlite-result.json') -Encoding UTF8
    $parsed = $report | ConvertFrom-Json
    if (-not $parsed.ok) { throw "Repository QA failed: $($parsed.failure)" }
    [ordered]@{ synthetic=$true; androidVerified=$true; assertions=$parsed.assertions; sourceSha256=(Get-FileHash -LiteralPath 'android/app/src/main/java/dev/shiye/app/ProductRepository.java' -Algorithm SHA256).Hash; fixtureSha256=(Get-FileHash -LiteralPath 'docs/contracts/android-product-sync-v1.fixture.json' -Algorithm SHA256).Hash; emulator=$Serial; mainPackageTouched=$false; phoneTouched=$false } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $outputRoot 'verification.json') -Encoding UTF8
    Write-Output "Repository Android SQLite QA passed: $($parsed.assertions) assertions."
} finally { Pop-Location }
