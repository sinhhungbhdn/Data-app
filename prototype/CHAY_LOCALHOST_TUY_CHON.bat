@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PORT=8765
where py >nul 2>nul
if %errorlevel%==0 (
  start "Bao Tin Local Server" /min py -m http.server %PORT%
  timeout /t 2 /nobreak >nul
  start "" http://127.0.0.1:%PORT%/index.html
  exit /b
)
where python >nul 2>nul
if %errorlevel%==0 (
  start "Bao Tin Local Server" /min python -m http.server %PORT%
  timeout /t 2 /nobreak >nul
  start "" http://127.0.0.1:%PORT%/index.html
  exit /b
)
echo May chua co Python. Hay dung CHAY_UNG_DUNG.bat.
pause
