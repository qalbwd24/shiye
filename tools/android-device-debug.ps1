[CmdletBinding()]
param(
    [ValidateSet('Status', 'Mirror', 'WebView', 'StopWebView')]
    [string]$Action = 'Status',
    [switch]$ReadOnly
)
$ErrorActionPreference = 'Stop'
$cfg = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'android-device-debug.json') -Encoding UTF8 -Raw | ConvertFrom-Json
$projectRoot = Split-Path -Parent $PSScriptRoot
$sessionDir = Join-Path $projectRoot 'outputs/android-device-debug-session'
$statePath = Join-Path $sessionDir 'webview-forward.json'
New-Item -ItemType Directory -Path $sessionDir -Force | Out-Null

function Invoke-DeviceAdb([string[]]$Arguments) {
    $result = @(& $cfg.adb @Arguments 2>&1)
    if ($LASTEXITCODE -ne 0) { throw ('ADB failed: ' + ($result -join "`n")) }
    return ($result -join "`n").Trim()
}
function Get-ForwardRows {
    $rows = Invoke-DeviceAdb @('forward', '--list')
    foreach ($line in ($rows -split "`n")) {
        $parts = $line.Trim() -split '\s+'
        if ($parts.Count -eq 3) {
            [pscustomobject]@{ Serial=$parts[0]; Local=$parts[1]; Remote=$parts[2] }
        }
    }
}
function Test-OwnedForward($state) {
    return [bool](@(Get-ForwardRows | Where-Object {
        $_.Serial -eq $state.serial -and $_.Local -eq ('tcp:' + $state.port) -and $_.Remote -eq $state.remote
    }).Count)
}
function Remove-OwnedForward {
    if (Test-Path -LiteralPath $statePath) {
        $state = Get-Content -LiteralPath $statePath -Encoding UTF8 -Raw | ConvertFrom-Json
        if ($state.owner -ne 'shiye-device-debug' -or $state.serial -ne $cfg.serial) {
            throw 'Refusing to remove an unrecognized debug forward.'
        }
        if (Test-OwnedForward $state) {
            Invoke-DeviceAdb @('-s', $cfg.serial, 'forward', '--remove', ('tcp:' + $state.port)) | Out-Null
        }
        Remove-Item -LiteralPath $statePath
    }
}
if ($Action -eq 'StopWebView') {
    Remove-OwnedForward
    Write-Output 'Project WebView forwarding stopped. Other ADB connections are unchanged.'
    return
}
if (-not (Test-Path -LiteralPath $cfg.adb)) { throw 'Configured ADB executable was not found.' }
if ((Invoke-DeviceAdb @('-s', $cfg.serial, 'get-state')) -ne 'device') { throw 'The configured USB phone is not online.' }

if ($Action -eq 'Status') {
    $packageInfo = Invoke-DeviceAdb @('-s', $cfg.serial, 'shell', 'dumpsys', 'package', $cfg.package)
    [pscustomobject]@{
        Serial=$cfg.serial
        Model=(Invoke-DeviceAdb @('-s', $cfg.serial, 'shell', 'getprop', 'ro.product.model'))
        Package=$cfg.package
        VersionCode=([regex]::Match($packageInfo, 'versionCode=(\d+)').Groups[1].Value)
        VersionName=([regex]::Match($packageInfo, 'versionName=([^\r\n]+)').Groups[1].Value.Trim())
        Debuggable=[bool]($packageInfo -match '\bDEBUGGABLE\b')
        ScrcpyInstalled=(Test-Path -LiteralPath $cfg.scrcpy)
    } | ConvertTo-Json
    return
}
if ($Action -eq 'Mirror') {
    if (-not (Test-Path -LiteralPath $cfg.scrcpy)) { throw 'Configured scrcpy executable was not found.' }
    $previousAdb = $env:ADB
    try {
        $env:ADB = $cfg.adb
        $scrcpyArgs = @('--serial=' + $cfg.serial)
        $scrcpyArgs += @('--no-audio', '--no-clipboard-autosync', '--no-power-on',
            '--max-size=1600', '--max-fps=60', '--port=29850:29859', '--window-title=Shiye-USB-Debug')
        if ($ReadOnly) { $scrcpyArgs += '--no-control' }
        & $cfg.scrcpy @scrcpyArgs
        if ($LASTEXITCODE -ne 0) { throw 'scrcpy exited with an error.' }
    } finally { $env:ADB = $previousAdb }
    return
}

# Resolve the sample application's current process each time; an App restart
# invalidates its old DevTools socket. Never attach to another application's PID.
$processText = Invoke-DeviceAdb @('-s', $cfg.serial, 'shell', 'pidof', $cfg.package)
if ($processText -notmatch '^\d+(?:\s+\d+)*$') { throw 'Open the Shiye sample App on the phone first.' }
$appProcess = ($processText -split '\s+')[0]
$socketName = 'webview_devtools_remote_' + $appProcess
$sockets = Invoke-DeviceAdb @('-s', $cfg.serial, 'shell', 'cat', '/proc/net/unix')
if ($sockets -notmatch ('@' + [regex]::Escape($socketName) + '(?:\r?$)')) {
    # Multiline socket list: match a complete socket name at a line boundary.
    if ($sockets -notmatch ('(?m)@' + [regex]::Escape($socketName) + '\s*$')) {
        throw 'No debug WebView socket yet. Open a chat list or diary editor in the sample App.'
    }
}
$state = $null
if (Test-Path -LiteralPath $statePath) {
    $previous = Get-Content -LiteralPath $statePath -Encoding UTF8 -Raw | ConvertFrom-Json
    if ($previous.owner -eq 'shiye-device-debug' -and $previous.serial -eq $cfg.serial -and
        $previous.remote -eq ('localabstract:' + $socketName) -and (Test-OwnedForward $previous)) {
        $state = $previous
    } else { Remove-OwnedForward }
}
if (-not $state) {
    $port = Invoke-DeviceAdb @('-s', $cfg.serial, 'forward', '--no-rebind', 'tcp:0', ('localabstract:' + $socketName))
    if ($port -notmatch '^\d+$') { throw 'ADB did not return a valid debug port.' }
    $state = [pscustomobject]@{ owner='shiye-device-debug'; serial=$cfg.serial; package=$cfg.package;
        pid=$appProcess; port=[int]$port; remote=('localabstract:' + $socketName); createdUtc=[DateTime]::UtcNow.ToString('o') }
    $state | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8
}
$baseUrl = 'http://127.0.0.1:' + $state.port
$version = Invoke-RestMethod -Uri ($baseUrl + '/json/version') -TimeoutSec 5
$targets = Invoke-RestMethod -Uri ($baseUrl + '/json/list') -TimeoutSec 5
$targets = @($targets)
$summary = [pscustomobject]@{ Serial=$cfg.serial; Package=$cfg.package; AppPid=$appProcess;
    Browser=$version.Browser; Protocol=$version.'Protocol-Version'; Port=$state.port;
    PageCount=@($targets | Where-Object type -EQ 'page').Count; TargetsUrl=($baseUrl + '/json/list');
    Inspector='chrome://inspect/#devices'; CheckedUtc=[DateTime]::UtcNow.ToString('o') }
$summary | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $sessionDir 'connection.json') -Encoding UTF8
$links = @()
$pageIndex = 0
foreach ($target in $targets) {
    if ($target.type -ne 'page' -or -not $target.devtoolsFrontendUrl) { continue }
    $frontend = [uri]$target.devtoolsFrontendUrl
    if ($frontend.Scheme -ne 'https' -or $frontend.Host -ne 'chrome-devtools-frontend.appspot.com') { continue }
    $pageIndex++
    $safeUrl = [System.Net.WebUtility]::HtmlEncode($frontend.AbsoluteUri)
    $links += ('<li><a target="_blank" rel="noopener" href="' + $safeUrl + '">Inspect WebView ' + $pageIndex + '</a></li>')
}
$inspectHtml = '<!doctype html><html><meta charset="utf-8"><title>Shiye WebView Debug</title>' +
    '<style>body{font:16px system-ui;max-width:760px;margin:50px auto;padding:20px;line-height:1.8}a{color:#17669b}li{margin:14px 0}</style>' +
    '<h1>Shiye WebView Debug</h1><p>USB sample App: dev.shiye.visualqa</p><ul>' + ($links -join '') +
    '</ul><p>After restarting the App, run WebView again to refresh this page.</p><p>Alternative: open chrome://inspect/#devices, enable Discover network targets and add 127.0.0.1:' +
    $state.port + '.</p></html>'
$inspectHtml | Set-Content -LiteralPath (Join-Path $sessionDir 'inspect.html') -Encoding UTF8
$summary | ConvertTo-Json
Write-Output ('In Chrome inspect, enable Discover network targets and add: 127.0.0.1:' + $state.port)
Write-Output 'Run WebView again after restarting the App; it refreshes only this project-owned forward.'
if ($summary.PageCount -eq 0) { Write-Warning 'Debug socket is connected, but no page target is active. Open a webpage screen in the sample App and run again.' }
