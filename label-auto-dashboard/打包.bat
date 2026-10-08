@echo off
cd /d "%~dp0"

rem =====================================================================
rem  Build BOTH exes. They MUST always be built together from the same code:
rem    dist\LabelAuto-Admin.exe  -> admin build  (LABEL_AUTO_RELEASE=0)
rem    dist\LabelAuto-Staff.exe  -> staff build  (LABEL_AUTO_RELEASE=1)
rem  Who gets which:
rem    LabelAuto-Admin.exe  = for the super admin: all three platforms
rem      (dashboard + QC + annotate), built-in accounts, can switch
rem      reviewer / annotator / platform.
rem    LabelAuto-Staff.exe  = for employees (QC reviewers + annotators):
rem      logs in with the user's own account, enters only the platform that
rem      account has permission for, cannot switch to another annotator or
rem      reviewer, and uses the built-in admin account when a reviewer needs
rem      to save box changes.
rem  Never build only one of them - the two packages would drift apart.
rem =====================================================================

echo [1/4] Closing running instances (they lock dist\*.exe and would break the build)...
taskkill /IM LabelAuto-Admin.exe /F >nul 2>nul
taskkill /IM LabelAuto-Staff.exe /F >nul 2>nul
rem legacy names (before the rename) - an old instance would also block a new one
taskkill /IM label-auto-dashboard.exe /F >nul 2>nul
taskkill /IM label-auto-v2.exe /F >nul 2>nul

echo [2/4] Checking PyInstaller...
python -m PyInstaller --version >nul 2>nul
if errorlevel 1 (
    echo PyInstaller not found, installing...
    python -m pip install pyinstaller
    if errorlevel 1 goto fail
)

echo [3/4] Building ADMIN -^> dist\LabelAuto-Admin.exe ...
python -m PyInstaller --noconfirm LabelAuto-Admin.spec
if errorlevel 1 goto fail

echo [4/4] Building STAFF -^> dist\LabelAuto-Staff.exe ...
python -m PyInstaller --noconfirm LabelAuto-Staff.spec
if errorlevel 1 goto fail

echo.
echo Build OK. dist\ now contains:
dir /b dist\*.exe
echo.
echo Staff exe SHA256 -- paste this into version.json as the "sha256" field
echo (the client refuses to self-update when sha256 is missing or mismatched):
certutil -hashfile dist\LabelAuto-Staff.exe SHA256
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
