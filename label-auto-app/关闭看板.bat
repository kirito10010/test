@echo off
chcp 65001 >nul
set PORT=5221

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5221 " ^| findstr "LISTENING"') do (
    echo 关闭 PID %%a ...
    taskkill /PID %%a /F >nul 2>nul
)

echo 已关闭端口 %PORT% 上的看板进程。
pause
