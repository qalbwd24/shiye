$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskConfig = Get-Content -LiteralPath (Join-Path $taskRoot 'config\app.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$taskCompiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (!(Test-Path -LiteralPath $taskCompiler)) { throw '未找到 .NET Framework C# 编译器' }
$taskBuild = Join-Path $taskRoot 'build'
New-Item -ItemType Directory -Path $taskBuild -Force | Out-Null
$taskSource = Get-Content -LiteralPath (Join-Path $taskRoot 'desktop\Launcher.cs') -Raw -Encoding UTF8
$taskSource = $taskSource.Replace('http://127.0.0.1:18765', ('http://' + $taskConfig.host + ':' + $taskConfig.port))
if ($taskConfig.id -notmatch '^[a-z0-9-]+$') { throw 'Invalid application id' }
$taskSource = $taskSource.Replace('diary-desktop-preview', $taskConfig.id)
$taskGenerated = Join-Path $taskBuild 'Launcher.generated.cs'
Set-Content -LiteralPath $taskGenerated -Value $taskSource -Encoding UTF8
$taskOutput = Join-Path $taskRoot '拾页日记.exe'
$taskIcon = Join-Path $taskRoot 'public\icons\shiye.ico'
if (!(Test-Path -LiteralPath $taskIcon)) { throw '缺少应用图标 public\icons\shiye.ico' }
& $taskCompiler /nologo /target:winexe /reference:System.Windows.Forms.dll ("/win32icon:" + $taskIcon) ("/out:" + $taskOutput) $taskGenerated
if ($LASTEXITCODE -ne 0) { throw '启动器编译失败' }
Write-Output ('已生成：' + $taskOutput)
