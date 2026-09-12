@echo off
cd /d "%~dp0"
set PORT=5221

rem Check if port 5221 is occupied; if so, kill the process first
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5221 " ^| findstr "LISTENING"') do (
    echo Port %PORT% is occupied by PID %%a, closing it...
    taskkill /PID %%a /F >nul 2>nul
)

where python >nul 2>nul && (python dashboard.py) || (py dashboard.py)
pause
