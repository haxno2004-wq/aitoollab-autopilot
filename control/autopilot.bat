@echo off
rem Empire autopilot — Telegram watchdog. Starts the forever loop; safe to run
rem twice (only one instance acts on state file, extra instance is harmless but
rem unnecessary). Register once with Task Scheduler (logon trigger):
rem   schtasks /Create /TN "EmpireAutopilot" /SC ONLOGON /TR "%~dp0autopilot.bat"
cd /d "%~dp0"
if not exist logs mkdir logs
"..\\trading-agent\\.venv\\Scripts\\python.exe" autopilot.py >> logs\\autopilot.log 2>&1
