# WifiChat
Your Network. Your Chat.
A private, local-network chat application that works entirely within your Wi-Fi/LAN. No internet required. No cloud servers. No accounts.

## Features

- **Pure LAN Communication** — messages travel directly through your local network
- **Automatic Discovery** — mDNS advertisement plus browser LAN scan (`/info` probe)
- **Real-time Messaging** — WebSocket instant messaging with echo confirmation
- **Group Chats & Direct Messages** — create/join rooms, 1-to-1 DMs
- **Typing Indicators, Message History, File/Image Sharing** (1 GB default, tunable via `pnpm dev --file-size 50`)
- **Dark Theme** — pitch-black UI with Space Grotesk font
- **Cross-Platform** — Windows, macOS, Linux, Android, iOS (any modern browser)
- **No Cloud Dependency** — runs entirely offline on your local network
- **Responsive** — three-column desktop, Chats → Chat → Info on mobile

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+ (`npm install -g pnpm` if needed)

### Development (one device)

```bash
cd wifiroom

# Linux/macOS
./run-dev.sh

# Windows
run-dev.bat
```

This starts:

- **Server + app** on `http://localhost:3000` (also serves the client UI)
- **WebSocket** on `ws://localhost:3000/ws`
- **Client dev server** on `http://localhost:5173` (hot reload)

### File size limit

Attachments default to **1 GB** max. Change it for a dev session:

```bash
pnpm dev --file-size 50    # 50 MB instead (max 4 GB)
```

(`MAX_FILE_SIZE_MB=50 pnpm dev` works too.) The client checks before sending
and the server re-validates — both sides use the same value in dev. For
production, set it on each side separately: `MAX_FILE_SIZE_MB=100 pnpm
--filter @wifichat/server start` for the server, and
`VITE_MAX_FILE_SIZE_MB=100 pnpm run build:client` for the UI (baked in at
build time). Only `mp4`/`webm`/`ogg` video plays inline; other formats
(`mov`, `avi`, `mkv`, …) arrive as download cards.

### Production Build

```bash
# Linux/macOS
./build.sh

# Windows
build.bat
```

Then run the server:

```bash
pnpm --filter @wifichat/server start
```

The server serves the built client UI itself — no extra static server needed.

## Running on Two or More Devices (Same Wi-Fi)

1. **On the host device**, build and start the server:
   ```bash
   pnpm run build
   pnpm --filter @wifichat/server start
   ```
   Note the LAN URLs it prints, e.g. `http://192.168.1.50:3000`.

2. **On every other device** (phone, laptop, tablet) connected to the **same Wi-Fi**,
   open a browser and go to:
   ```
   http://wifichat.local:3000
   ```
   The server answers mDNS queries for `wifichat.local`, so no IP hunting.
   If that name doesn't resolve on your network, use the host's LAN IP
   instead (e.g. `http://192.168.1.50:3000`).

3. **Pick a username** on each device. The app scans the LAN and lists any
   WifiChat servers it finds — or type the address manually.

4. **Start chatting.** Everyone auto-joins the `General` room. Create extra rooms
   (e.g. `Gaming Room`) or click a person for a 1-to-1 DM.

> Internet goes down but Wi-Fi stays up? Messaging keeps working — nothing ever
> leaves your local network.

### Finding Your LAN IP

**Linux/macOS:**

```bash
hostname -I | awk '{print $1}'  # Linux
ipconfig getifaddr en0           # macOS
```

**Windows:**

```cmd
ipconfig | findstr /R "IPv4"
```

## Architecture

```
wifiroom/
├── server/          # Node.js WebSocket server + mDNS discovery
│   ├── src/
│   │   ├── index.ts     # Entry point, HTTP + WS server, static UI
│   │   ├── config.ts    # Max file size (CLI --file-size / MAX_FILE_SIZE_MB)
│   │   ├── discovery.ts # mDNS/Bonjour advertisement + browsing
│   │   ├── rooms.ts     # Room + DM management, history
│   │   ├── clients.ts   # Connection registry, rate limiting
│   │   ├── messages.ts  # Validation (incl. file-size cap), broadcast, typing
│   │   ├── auth.ts      # Temporary JWT session tokens
│   │   └── utils/       # logger, crypto, network
├── client/          # React + TypeScript frontend
│   ├── src/
│   │   ├── components/  # chat, sidebar, infoPanel, layout, ui
│   │   ├── context/     # zustand stores
│   │   ├── services/    # websocket, discovery (LAN scan), storage, crypto, notifications
│   │   ├── utils/       # dm, messagePreview, limits (VITE_MAX_FILE_SIZE_MB)
│   │   └── hooks/       # useMediaQuery
├── shared/          # Shared TypeScript protocol types
│   └── src/types.ts
├── scripts/dev.mjs  # Dev launcher (parses --file-size, spawns server+client)
├── run-dev.sh/.bat  # Development startup scripts
└── build.sh/.bat    # Production build scripts
```

## Network Protocol

### Discovery

- **mDNS**: `_wifichat._tcp.local` advertised by the server (name `WifiChat`)
- **Browser scan**: the client detects its LAN IP via WebRTC, sweeps the `/24`
  subnet with `GET http://<ip>:3000/info`, and lists responders
- **Manual entry**: any `http://<host>:3000` address can be typed directly

### WebSocket Messages (`ws://<host>:3000/ws`, JSON)

```typescript
// Client → Server
{ type: 'auth', username: 'Alex' }
{ type: 'join_room', roomId: '...' }
{ type: 'message', roomId: '...', content: 'Hello', messageType: 'text' }
{ type: 'typing', roomId: '...', isTyping: true }
{ type: 'create_room', name: 'Gaming Room', isPrivate: false }
{ type: 'ping' }

// Server → Client
{ type: 'auth_ok', userId, token, user, rooms, users }
{ type: 'user_joined', user, roomId }
{ type: 'user_left', userId, roomId }
{ type: 'message', message }
{ type: 'history', roomId, messages }
{ type: 'room_created', room }
{ type: 'room_list', rooms }
{ type: 'typing', userId, userName, roomId, isTyping }
{ type: 'user_status', userId, status }
{ type: 'error', code, message }
```

## Security

- **Input validation** on every payload; messages capped at 4000 chars
- **Sanitized rendering** — content rendered as text, never as HTML/JS
- **Temporary sessions** — short-lived JWT per login, random user IDs
- **Rate limiting** — 30 messages/minute per connection
- **LAN-only by default** — binds `0.0.0.0:3000` for LAN access; never exposed
  to the public internet unless you port-forward (don't)
- **File caps** — attachments limited to 1 GB data URLs by default (tunable: `pnpm dev --file-size 50`)

## Browser Support

- Chrome 90+, Firefox 88+, Safari 15+, Edge 90+
- Mobile browsers supported via responsive layout

## Troubleshooting

### "No servers found"

- Ensure all devices are on the **same Wi-Fi network** (not guest network / mobile data)
- The host must be running `pnpm run dev:server` or `pnpm --filter @wifichat/server start` (built)
- Check the firewall allows TCP 3000; on Windows set the network profile to "Private"
- Try the manual address field: `http://<HOST_LAN_IP>:3000`
- Verify with `curl http://<HOST_LAN_IP>:3000/info` from another machine

### "Connection failed" / reconnecting…

- Verify the host IP is correct and the server is still running
- VPNs and client isolation ("AP isolation") on some routers block LAN traffic — disable if needed

### Messages not delivering

- Check the sidebar shows "online" (connected) status
- Verify both devices are in the same room
- Check the browser console for errors

### "File too large"

- The attachment exceeds the server/client limit (default 1 GB) — restart dev
  with a higher cap, e.g. `pnpm dev --file-size 2000`
- Video that arrives as a download card instead of a player is an unsupported
  codec (`mov`/`avi`/`mkv`) — download it and play locally, or re-encode to
  `mp4`/`webm`

## License

MIT — feel free to use and modify.
