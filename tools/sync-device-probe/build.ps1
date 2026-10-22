param(
  [string]$ProjectRoot = 'D:\拾页',
  [string]$BuildDir = '',
  [string]$OutputDir = ''
)
$ErrorActionPreference = 'Stop'
$taskSource = Join-Path $ProjectRoot 'tools\sync-device-probe'
$taskBuild = if ($BuildDir) { [IO.Path]::GetFullPath($BuildDir) } else { Join-Path $ProjectRoot 'tmp\sync-device-test\probe-build' }
$taskOutput = if ($OutputDir) { [IO.Path]::GetFullPath($OutputDir) } else { Join-Path $ProjectRoot 'outputs\sync-device-test' }
$taskJava = 'D:\codex-tools\android-studio\jbr'
$taskSdk = 'D:\codex-tools\android-sdk'
$taskTools = Join-Path $taskSdk 'build-tools\36.0.0'
New-Item -ItemType Directory -Path $taskBuild,(Join-Path $taskBuild 'classes'),(Join-Path $taskBuild 'dex'),$taskOutput -Force | Out-Null
$env:JAVA_HOME = $taskJava
$taskJar = Join-Path $taskSdk 'platforms\android-36\android.jar'
& (Join-Path $taskJava 'bin\javac.exe') -encoding UTF-8 --release 8 -classpath $taskJar -d (Join-Path $taskBuild 'classes') (Join-Path $taskSource 'ProbeReceiver.java') (Join-Path $taskSource 'ProbeActivity.java')
if ($LASTEXITCODE -ne 0) { throw 'javac failed' }
$taskClasses = @(Get-ChildItem (Join-Path $taskBuild 'classes') -Filter '*.class' -Recurse | ForEach-Object FullName)
& (Join-Path $taskTools 'd8.bat') --lib $taskJar --min-api 26 --output (Join-Path $taskBuild 'dex') @taskClasses
if ($LASTEXITCODE -ne 0) { throw 'd8 failed' }
$taskUnsigned = Join-Path $taskBuild 'unsigned.apk'
& (Join-Path $taskTools 'aapt.exe') package -f -M (Join-Path $taskSource 'AndroidManifest.xml') -I $taskJar -F $taskUnsigned
if ($LASTEXITCODE -ne 0) { throw 'aapt package failed' }
Push-Location (Join-Path $taskBuild 'dex')
try { & (Join-Path $taskTools 'aapt.exe') add $taskUnsigned classes.dex; if ($LASTEXITCODE -ne 0) { throw 'aapt dex failed' } } finally { Pop-Location }
$taskKey = Join-Path $taskBuild 'test-signing.jks'
if (-not (Test-Path -LiteralPath $taskKey)) {
  & (Join-Path $taskJava 'bin\keytool.exe') -genkeypair -keystore $taskKey -alias sync-probe -storepass android -keypass android -dname 'CN=ShiyeSyncProbe' -keyalg RSA -validity 7
  if ($LASTEXITCODE -ne 0) { throw 'test key generation failed' }
}
& (Join-Path $taskTools 'apksigner.bat') sign --ks $taskKey --ks-pass pass:android --key-pass pass:android --out (Join-Path $taskOutput 'sync-network-probe.apk') $taskUnsigned
if ($LASTEXITCODE -ne 0) { throw 'apksigner failed' }
Get-FileHash (Join-Path $taskOutput 'sync-network-probe.apk') -Algorithm SHA256
