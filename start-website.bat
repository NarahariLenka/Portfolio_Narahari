@echo off
title Portfolio - local preview
cd /d "%~dp0"
if not exist node_modules (
  echo Installing for the first time, this can take a minute...
  call npm install
)
echo.
echo Starting the website. Your browser will open automatically.
echo Keep this window open while you look at the site. Close it to stop.
echo.
call npm run dev
pause
