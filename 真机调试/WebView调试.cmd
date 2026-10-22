@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\tools\android-device-debug.ps1" -Action WebView
if errorlevel 1 (
  pause
  exit /b 1
)
start "" "%~dp0..\outputs\android-device-debug-session\inspect.html"
pause
