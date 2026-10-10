@echo off
chcp 65001 >nul
title 卡牌对战 - 本地开发服务器
cd /d "%~dp0"

set "NODE=C:\Users\winner\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"

if not exist "%NODE%" (
  echo 找不到 Node.js：%NODE%
  echo 请把本文件里的 NODE 路径改成你电脑上 node.exe 的实际位置。
  pause
  exit /b 1
)

echo 正在启动本地服务器...
echo 启动后请用浏览器打开下面显示的地址（通常是 http://localhost:5173/）
echo.
"%NODE%" "tools\dev-server.mjs" %*

echo.
echo 服务器已停止。
pause
