#!/bin/bash
# WifiChat - Development startup script for Linux/macOS

set -e

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                        WifiChat Dev                          ║"
echo "║              Private LAN Messaging Application                ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# Check Node.js version
NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "Error: Node.js 18+ is required. Current version: $(node --version)"
  exit 1
fi

# Install dependencies if needed (single install covers all workspace packages)
if [ ! -d "node_modules" ]; then
  echo "[Setup] Installing dependencies..."
  pnpm install
fi

# Build shared types
echo "[Build] Building shared types..."
pnpm run build:shared

# Start development servers
echo ""
echo "[Dev] Starting WifiChat servers..."
echo "  - WebSocket server: ws://localhost:3000/ws"
echo "  - Discovery: mDNS + LAN /info scan"
echo "  - App (served by host): http://localhost:3000  |  Client dev: http://localhost:5173"
echo ""
echo "Press Ctrl+C to stop all servers"
echo ""

# Run concurrently
pnpm dev