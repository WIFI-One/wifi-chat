@echo off
REM WifiChat - Production build script for Windows

echo ╔══════════════════════════════════════════════════════════════╗
echo ║                      WifiChat Build                          ║
echo ║              Private LAN Messaging Application                ║
echo ╚══════════════════════════════════════════════════════════════╝
echo.

REM Install dependencies
echo [Setup] Installing dependencies...
pnpm install --frozen-lockfile

REM Build all workspaces in order (shared -^> server -^> client)
echo [Build] Building all packages...
pnpm build

echo.
echo ╔══════════════════════════════════════════════════════════════╗
echo ║                        Build Complete                         ║
echo ╚══════════════════════════════════════════════════════════════╝
echo.
echo To run in production:
echo   pnpm --filter @wifichat/server start
echo   REM Then open http://HOST_LAN_IP:3000 on your other devices
echo.