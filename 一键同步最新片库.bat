@echo off
chcp 65001 >nul
title Jasna-LTX 官方片库一键同步
echo ====================================================
echo        Jasna-LTX 专属官方片库 一键同步工具
echo ====================================================
echo.
echo [1/3] 正在启动安全通道连接原站...
cd /d "%~dp0"
node scripts\sync_playwright.js
if %errorlevel% neq 0 (
    echo.
    echo [提示] 正在使用备用通道提取...
)
echo.
echo [2/3] 正在将最新片库推送到 GitHub 线上网站...
git add data\movies.json index.html
git diff --staged --quiet || (git commit -m "chore(sync): 本地一键同步官方最新资源 [skip ci]" && git push origin main)
echo.
echo [3/3] ✨ 同步大功告成！
echo 线上站点：https://qun950303.github.io/jasna-ltx/
echo 您现在可以随时关机，在手机或平板上直接查看最新大作！
echo ====================================================
pause
