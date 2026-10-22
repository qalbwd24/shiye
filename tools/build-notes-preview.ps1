param([string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$notesRoot = Split-Path -Parent $PSScriptRoot
$notesCompiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$notesVendor = Join-Path $notesRoot 'desktop\vendor\webview2'
$notesOutput = if ($OutputDirectory) { [IO.Path]::GetFullPath($OutputDirectory) } else { Join-Path $notesRoot 'outputs\notes-ui\app' }
if (!(Test-Path -LiteralPath $notesCompiler)) { throw '未找到 .NET Framework C# 编译器' }
New-Item -ItemType Directory -Path $notesOutput -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $notesRoot 'outputs\notes-ui\exports') -Force | Out-Null
foreach ($notesFile in @('Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll', 'WebView2Loader.dll', 'LICENSE.txt')) {
    Copy-Item -LiteralPath (Join-Path $notesVendor $notesFile) -Destination (Join-Path $notesOutput $notesFile) -Force
}
$notesExe = Join-Path $notesOutput '拾页便签.exe'
& $notesCompiler /nologo /target:winexe /platform:x64 /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll ("/reference:" + (Join-Path $notesVendor 'Microsoft.Web.WebView2.Core.dll')) ("/reference:" + (Join-Path $notesVendor 'Microsoft.Web.WebView2.WinForms.dll')) ("/win32icon:" + (Join-Path $notesRoot 'public\icons\shiye-hd.ico')) ("/out:" + $notesExe) (Join-Path $notesRoot 'desktop\NotesPreview.cs') (Join-Path $notesRoot 'desktop\NotesWindowFrame.cs') (Join-Path $notesRoot 'desktop\NotesFramePalette.cs')
if ($LASTEXITCODE -ne 0) { throw '拾页便签预览宿主编译失败' }
$notesConfig = @'
<?xml version="1.0" encoding="utf-8" ?>
<configuration>
  <startup><supportedRuntime version="v4.0" sku=".NETFramework,Version=v4.8" /></startup>
  <System.Windows.Forms.ApplicationConfigurationSection><add key="DpiAwareness" value="PerMonitorV2" /></System.Windows.Forms.ApplicationConfigurationSection>
</configuration>
'@
Set-Content -LiteralPath ($notesExe + '.config') -Value $notesConfig -Encoding UTF8
Write-Output ('已生成：' + $notesExe)
