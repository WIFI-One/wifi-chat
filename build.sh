#!/bin/bash
# WifiChat - Production build script

set -e

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                      WifiChat Build                          ║"
echo "║              Private LAN Messaging Application                ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# Install dependencies
echo "[Setup] Installing dependencies..."
pnpm install --frozen-lockfile

# Build all workspaces in order (shared -> server -> client)
echo "[Build] Building all packages..."
pnpm build

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                        Build Complete                         ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "To run in production:"
echo "  pnpm --filter @wifichat/server start"
echo "  # Then open http://<HOST_LAN_IP>:3000 on your other devices
  # (the server serves the built client UI itself - no extra static server needed)"
echo ""