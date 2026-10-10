@echo off
chcp 65001 >nul
title 卡牌对战 - 自检
cd /d "%~dp0"

set "NODE=C:\Users\winner\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"

if not exist "%NODE%" (
  echo 找不到 Node.js：%NODE%
  echo 请把本文件里的 NODE 路径改成你电脑上 node.exe 的实际位置。
  pause
  exit /b 1
)

echo 正在检查数据、战斗规则和界面生成...
echo.
"%NODE%" "tools\smoke-test.mjs"

echo.
echo 再跑一局完整对战给你看（终端里显示战斗日志）...
echo.
"%NODE%" "tools\simulate-battle.mjs"

echo.
pause
