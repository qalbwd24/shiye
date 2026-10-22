param([switch]$Build)
$ErrorActionPreference = 'Stop'
$notesRoot = Split-Path -Parent $PSScriptRoot
$notesExe = Join-Path $notesRoot 'outputs\notes-ui\app\拾页便签.exe'
$notesState = Join-Path $notesRoot 'var\notes-ui-preview'
$notesOutputs = Join-Path $notesRoot 'outputs\notes-ui'
$notesHealthUrl = 'http://127.0.0.1:18770/notes-preview-health'

function Get-NotesPreviewHealth {
    try { return Invoke-RestMethod -Uri $notesHealthUrl -TimeoutSec 2 } catch { return $null }
}
function Assert-NotesPreviewHealth($notesHealth) {
    if ($notesHealth.app -ne 'shiye-notes-ui-preview' -or $notesHealth.workspace -ne $notesRoot -or $notesHealth.port -ne 18770) {
        throw '18770 端口服务身份不匹配；未操作该进程。'
    }
}
if ($Build -or !(Test-Path -LiteralPath $notesExe)) { & (Join-Path $PSScriptRoot 'build-notes-preview.ps1') }
New-Item -ItemType Directory -Path $notesState,$notesOutputs -Force | Out-Null
$notesHealth = Get-NotesPreviewHealth
if ($null -ne $notesHealth) { Assert-NotesPreviewHealth $notesHealth }
else {
    if (Get-NetTCPConnection -LocalPort 18770 -State Listen -ErrorAction SilentlyContinue) { throw '18770 端口已被其他服务占用；未操作该进程。' }
    $notesNode = (Get-Command node -ErrorAction Stop).Source
    $notesService = Join-Path $PSScriptRoot 'serve-notes-preview.mjs'
    Start-Process -FilePath $notesNode -ArgumentList @('"' + $notesService + '"') -WorkingDirectory $notesRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $notesOutputs 'service.stdout.log') -RedirectStandardError (Join-Path $notesOutputs 'service.stderr.log') | Out-Null
    for ($notesAttempt = 0; $notesAttempt -lt 30; $notesAttempt++) {
        Start-Sleep -Milliseconds 200
        $notesHealth = Get-NotesPreviewHealth
        if ($null -ne $notesHealth) { break }
    }
    if ($null -eq $notesHealth) { throw '便签预览服务没有就绪，请检查 outputs\notes-ui 中的服务日志。' }
    Assert-NotesPreviewHealth $notesHealth
}
# Native app is the visible editor; only its background static-service helper is hidden.
$notesProcess = Start-Process -FilePath $notesExe -ArgumentList @('--url=http://127.0.0.1:18770/notes.html', ('--state-dir="' + $notesState + '"')) -WorkingDirectory (Split-Path -Parent $notesExe) -PassThru
Write-Output ('已打开拾页便签，PID ' + $notesProcess.Id + '；预览服务 PID ' + $notesHealth.pid)
