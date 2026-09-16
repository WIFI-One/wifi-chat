@echo off
REM WifiChat - Development startup script for Windows

echo ╔══════════════════════════════════════════════════════════════╗
echo ║                        WifiChat Dev                          ║
echo ║              Private LAN Messaging Application                ║
echo ╚══════════════════════════════════════════════════════════════╝
echo.

REM Check Node.js version
for /f "tokens=2 delims=v." %%a in ('node --version') do set NODE_MAJOR=%%a
if %NODE_MAJOR% LSS 18 (
  echo Error: Node.js 18+ is required. Current version:
  node --version
  exit /b 1
)

REM Install dependencies if needed (single install covers all workspace packages)
if not exist node_modules (
  echo [Setup] Installing dependencies...
  pnpm install
)

REM Build shared types
echo [Build] Building shared types...
pnpm run build:shared

echo.
echo [Dev] Starting WifiChat servers...
echo   - WebSocket server: ws://localhost:3000/ws
echo   - Discovery: mDNS + LAN /info scan
echo   - App (served by host): http://localhost:3000  |  Client dev: http://localhost:5173
echo.
echo Press Ctrl+C to stop all servers
echo.

pnpm dev