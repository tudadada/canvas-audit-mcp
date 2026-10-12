@echo off
title Push Canvas Audit MCP to GitHub
echo Dang day ma nguon len GitHub...
git push -u origin main
echo.
if %ERRORLEVEL% EQU 0 (
    echo === THANH CONG! Ma nguon da duoc day len GitHub! ===
) else (
    echo === CO LOI XAY RA, VUI LONG KIEM TRA DANG NHAP ===
)
pause
