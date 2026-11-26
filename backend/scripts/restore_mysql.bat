@echo off
setlocal enabledelayedexpansion

REM Restore a VerdantRoute MySQL backup (.sql) into a scratch verification schema on Windows CMD
REM Usage:
REM   set DB_PASSWORD=your_password
REM   backend\scripts\restore_mysql.bat backups\smart_waste_db_20261126_120000.sql smart_waste_db_restore_verify

if "%~1"=="" (
  echo Usage: backend\scripts\restore_mysql.bat ^<backup_file.sql^> [target_db]
  exit /b 1
)

set BACKUP_FILE=%~1
set TARGET_DB=%~2
if "%TARGET_DB%"=="" set TARGET_DB=smart_waste_db_restore_verify
if "%DB_HOST%"=="" set DB_HOST=localhost
if "%DB_PORT%"=="" set DB_PORT=3306
if "%DB_USERNAME%"=="" set DB_USERNAME=root

if "%DB_PASSWORD%"=="" (
  echo Error: DB_PASSWORD environment variable must be set.
  exit /b 1
)
if not exist "%BACKUP_FILE%" (
  echo Error: Backup file not found: %BACKUP_FILE%
  exit /b 1
)

set MYSQL_PWD=%DB_PASSWORD%
mysql -h %DB_HOST% -P %DB_PORT% -u %DB_USERNAME% -e "CREATE DATABASE IF NOT EXISTS `%TARGET_DB%` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
if errorlevel 1 (
  set MYSQL_PWD=
  exit /b 1
)

powershell -NoProfile -Command "(Get-Content -Raw '%BACKUP_FILE%') -replace '`smart_waste_db`','`%TARGET_DB%`' | mysql -h %DB_HOST% -P %DB_PORT% -u %DB_USERNAME% %TARGET_DB%"
if errorlevel 1 (
  set MYSQL_PWD=
  echo Restore failed.
  exit /b 1
)

mysql -h %DB_HOST% -P %DB_PORT% -u %DB_USERNAME% %TARGET_DB% -e "SHOW TABLES; SELECT COUNT(*) AS areas_count FROM areas;"
set MYSQL_PWD=
echo Restore verification completed for database: %TARGET_DB%
endlocal
