@echo off
REM Launch TradingView Desktop (Windows) with the remote-debugging port the MCP server needs.
REM Usage: launch_tv_debug_windows.bat [port]   (default 9222)

set PORT=%1
if "%PORT%"=="" set PORT=9222

set TV_EXE=%LOCALAPPDATA%\Programs\TradingView\TradingView.exe
if not exist "%TV_EXE%" set TV_EXE=%PROGRAMFILES%\TradingView\TradingView.exe

if not exist "%TV_EXE%" (
    echo TradingView Desktop not found. Install it from tradingview.com/desktop
    exit /b 1
)

tasklist /FI "IMAGENAME eq TradingView.exe" | find /I "TradingView.exe" >nul
if not errorlevel 1 (
    echo TradingView is already running. Close it first so it can relaunch with the debug port.
    exit /b 1
)

echo Launching TradingView with --remote-debugging-port=%PORT% ...
start "" "%TV_EXE%" --remote-debugging-port=%PORT%
