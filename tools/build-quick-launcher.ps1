param([string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskOutputRoot = if ($OutputDirectory) { [IO.Path]::GetFullPath($OutputDirectory) } else { $taskRoot }
$taskVersion = '1.0.4191.47'
$taskConfig = Get-Content -LiteralPath (Join-Path $taskRoot 'config\app.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$taskCompiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$taskPackage = Join-Path $taskRoot ('resources\vendor\microsoft.web.webview2.' + $taskVersion + '.nupkg')
if (!(Test-Path -LiteralPath $taskCompiler)) { throw '未找到 .NET Framework C# 编译器' }
if (!(Test-Path -LiteralPath $taskPackage)) { throw ('缺少官方 WebView2 SDK 包：' + $taskPackage) }
$taskExpectedSha = 'F492BBF547D0DA329553B6727435B677579B1E9F91CC9E4A1AD029366D5F23D0'
if ((Get-FileHash -LiteralPath $taskPackage -Algorithm SHA256).Hash -ne $taskExpectedSha) { throw 'WebView2 SDK 校验失败' }
$taskBuild = Join-Path $taskRoot 'build\quick-capture'
$taskVendor = Join-Path $taskOutputRoot 'desktop\vendor\webview2'
New-Item -ItemType Directory -Path $taskBuild,$taskVendor -Force | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
$taskArchive = [IO.Compression.ZipFile]::OpenRead($taskPackage)
try {
    $taskItems = @{
        'lib/net462/Microsoft.Web.WebView2.Core.dll' = 'Microsoft.Web.WebView2.Core.dll'
        'lib/net462/Microsoft.Web.WebView2.WinForms.dll' = 'Microsoft.Web.WebView2.WinForms.dll'
        'runtimes/win-x64/native/WebView2Loader.dll' = 'WebView2Loader.dll'
        'LICENSE.txt' = 'LICENSE.txt'
    }
    foreach ($taskName in $taskItems.Keys) {
        $taskEntry = $taskArchive.GetEntry($taskName)
        if (!$taskEntry) { throw ('SDK 缺少文件：' + $taskName) }
        [IO.Compression.ZipFileExtensions]::ExtractToFile($taskEntry, (Join-Path $taskVendor $taskItems[$taskName]), $true)
    }
} finally { $taskArchive.Dispose() }
$taskSource = Get-Content -LiteralPath (Join-Path $taskRoot 'desktop\QuickCapture.cs') -Raw -Encoding UTF8
$taskSource = $taskSource.Replace('http://127.0.0.1:18765', ('http://' + $taskConfig.host + ':' + $taskConfig.port))
if ($taskConfig.id -notmatch '^[a-z0-9-]+$') { throw 'Invalid application id' }
$taskSource = $taskSource.Replace('diary-desktop-preview', $taskConfig.id)
$taskGenerated = Join-Path $taskBuild 'QuickCapture.generated.cs'
Set-Content -LiteralPath $taskGenerated -Value $taskSource -Encoding UTF8
New-Item -ItemType Directory -Path $taskOutputRoot -Force | Out-Null
$taskOutput = Join-Path $taskOutputRoot '拾页快捷记录.exe'
$taskIcon = Join-Path $taskRoot 'public\icons\shiye-hd.ico'
& $taskCompiler /nologo /target:winexe /platform:x64 /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.dll /reference:System.Web.Extensions.dll ("/reference:" + (Join-Path $taskVendor 'Microsoft.Web.WebView2.Core.dll')) ("/reference:" + (Join-Path $taskVendor 'Microsoft.Web.WebView2.WinForms.dll')) ("/win32icon:" + $taskIcon) ("/out:" + $taskOutput) $taskGenerated (Join-Path $taskRoot 'desktop\QuickHost.cs') (Join-Path $taskRoot 'desktop\DesktopPaths.cs')
if ($LASTEXITCODE -ne 0) { throw '快捷启动器编译失败' }
# CLR private probing keeps third-party managed assemblies out of the root directory.
$taskApplicationConfig = @'
<?xml version="1.0" encoding="utf-8" ?>
<configuration>
  <startup><supportedRuntime version="v4.0" sku=".NETFramework,Version=v4.8" /></startup>
  <System.Windows.Forms.ApplicationConfigurationSection><add key="DpiAwareness" value="PerMonitorV2" /></System.Windows.Forms.ApplicationConfigurationSection>
  <runtime><assemblyBinding xmlns="urn:schemas-microsoft-com:asm.v1"><probing privatePath="desktop/vendor/webview2" /></assemblyBinding></runtime>
</configuration>
'@
Set-Content -LiteralPath ($taskOutput + '.config') -Value $taskApplicationConfig -Encoding UTF8
# Native loader follows the x64 runtime layout expected by WebView2.
$taskNative = Join-Path $taskOutputRoot 'runtimes\win-x64\native'
New-Item -ItemType Directory -Path $taskNative -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $taskVendor 'WebView2Loader.dll') -Destination $taskNative -Force
# The unmanaged loader must be beside the generated executable for the CLR DLL search path.
Copy-Item -LiteralPath (Join-Path $taskVendor 'WebView2Loader.dll') -Destination (Join-Path $taskOutputRoot 'WebView2Loader.dll') -Force
Write-Output ('已生成：' + $taskOutput)
