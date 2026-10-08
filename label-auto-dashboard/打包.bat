@echo off
cd /d "%~dp0"

rem =====================================================================
rem  Build BOTH exes. They MUST always be built together from the same code:
rem    dist\label-auto-dashboard.exe  -> dev     (LABEL_AUTO_RELEASE=0)
rem    dist\label-auto-v2.exe         -> release (LABEL_AUTO_RELEASE=1)
rem  The only difference is the runtime hook + RELEASE_MODE behaviour:
rem    release logs in with the user's own account, enters only the platform
rem    that account has permission for (annotate / QC), cannot switch to
rem    another annotator/reviewer, and uses the built-in admin account when a
rem    reviewer needs to save box changes.
rem  Never build only one of them - the two packages would drift apart.
rem =====================================================================

echo [1/4] Closing running instances (they lock dist\*.exe and would break the build)...
taskkill /IM label-auto-dashboard.exe /F >nul 2>nul
taskkill /IM label-auto-v2.exe /F >nul 2>nul

echo [2/4] Checking PyInstaller...
python -m PyInstaller --version >nul 2>nul
if errorlevel 1 (
    echo PyInstaller not found, installing...
    python -m pip install pyinstaller
    if errorlevel 1 goto fail
)

echo [3/4] Building DEV     -^> dist\label-auto-dashboard.exe ...
python -m PyInstaller --noconfirm label-auto-dashboard.spec
if errorlevel 1 goto fail

echo [4/4] Building RELEASE -^> dist\label-auto-v2.exe ...
python -m PyInstaller --noconfirm label-auto-v2.spec
if errorlevel 1 goto fail

echo.
echo Build OK. dist\ now contains:
dir /b dist\*.exe
echo.
echo Release exe SHA256 -- paste this into version.json as the "sha256" field
echo (the client refuses to self-update when sha256 is missing or mismatched):
certutil -hashfile dist\label-auto-v2.exe SHA256
echo.
echo Reminder: for a new release, update version.json (version / notes / download_url / sha256)
echo           so release builds can self-update.
echo           Do NOT rebuild after filling in sha256, or the hash becomes stale.
pause
exit /b 0

:fail
echo.
echo BUILD FAILED - dist\ may be incomplete, do NOT ship it.
echo If you see "PermissionError" / "Access is denied" about dist\*.exe, some
echo process still holds the file - close it and run this script again.
pause
exit /b 1
