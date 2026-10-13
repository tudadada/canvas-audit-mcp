@echo off
title Push Canvas Audit Monorepo to GitHub
echo Pushing source code to GitHub...
git push origin main
echo.
if %ERRORLEVEL% EQU 0 (
    echo === SUCCESS! Source code successfully pushed to GitHub! ===
) else (
    echo === AN ERROR OCCURRED, PLEASE CHECK AUTHENTICATION ===
)
pause
