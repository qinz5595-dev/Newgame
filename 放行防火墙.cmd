@echo off
chcp 65001 >nul
title 卡牌对战 - 放行防火墙（需要管理员权限）
cd /d "%~dp0"

rem ============================================================
rem  作用：让"同一个局域网里的其他电脑 / 手机"能访问本机的 5173 端口
rem  用法：右键本文件 → 以管理员身份运行
rem  只放行本局域网（remoteip=localsubnet），公网设备仍然访问不到
rem ============================================================

net session >nul 2>&1
if errorlevel 1 (
  echo.
  echo   这个文件需要"以管理员身份运行"。
  echo   方法：在文件上点右键 → 以管理员身份运行。
  echo.
  pause
  exit /b 1
)

echo.
echo   正在添加放行规则（TCP 5173，只允许本局域网）...
echo.

netsh advfirewall firewall add rule name="卡牌对战 5173（局域网）" dir=in action=allow protocol=TCP localport=5173 remoteip=localsubnet profile=any

echo.
echo   完成。现在可以让同一 WiFi 下的朋友用下面这种地址访问：
echo       http://你的局域网IP:5173/
echo.
echo   如果以后想撤销这条规则，右键以管理员身份运行下面这行：
echo       netsh advfirewall firewall delete rule name="卡牌对战 5173（局域网）"
echo.
pause
