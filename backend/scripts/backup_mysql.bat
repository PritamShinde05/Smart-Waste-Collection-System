@echo off
setlocal enabledelayedexpansion

REM Automated MySQL backup script for VerdantRoute (smart_waste_db) on Windows CMD
REM Usage:
REM   set DB_PASSWORD=your_password
REM   backend\scripts\backup_mysql.bat

if "%DB_HOST%"=="" set DB_HOST=localhost
if "%DB_PORT%"=="" set DB_PORT=3306
if "%DB_NAME%"=="" set DB_NAME=smart_waste_db
if "%DB_USERNAME%"=="" set DB_USERNAME=root
if "%BACKUP_DIR%"=="" set BACKUP_DIR=backups

if "%DB_PASSWORD%"=="" (
  echo Error: DB_PASSWORD environment variable must be set.
  exit /b 1
)

if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"

for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value') do set datetime=%%I
set STAMP=%datetime:~0,8%_%datetime:~8,6%
set OUT_FILE=%BACKUP_DIR%\%DB_NAME%_%STAMP%.sql

set MYSQL_PWD=%DB_PASSWORD%
mysqldump -h %DB_HOST% -P %DB_PORT% -u %DB_USERNAME% --single-transaction --routines --triggers --databases %DB_NAME% > "%OUT_FILE%"
set MYSQL_PWD=

if errorlevel 1 (
  echo Backup failed.
  exit /b 1
)

echo Backup created successfully: %OUT_FILE%
endlocal
