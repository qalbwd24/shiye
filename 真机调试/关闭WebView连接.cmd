@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\tools\android-device-debug.ps1" -Action StopWebView
pause
