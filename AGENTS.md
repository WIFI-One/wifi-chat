# WifiChat - Local Wi-Fi Chat Application

Local-network chat (no internet). Node.js WebSocket server + React client,
pnpm workspaces. Server serves the built client UI itself in production.

## Repo layout (actual)

```
wifiroom/
├── AGENTS.md
├── README.md
├── package.json            # root scripts (pnpm), workspaces: server, client, shared
├── pnpm-workspace.yaml     # canonical workspaces + esbuild build approval
├── tsconfig.json           # root base config (excludes node_modules, dist)
├── run-dev.sh / run-dev.bat
├── build.sh / build.bat
├── server/                 # @wifichat/server, ESM ("type": "module")
│   ├── src/
│   │   ├── index.ts        # entry: HTTP + WS (/ws) + /info + static client/dist
│   │   ├── auth.ts         # JWT session tokens, validateAuthPayload
│   │   ├── clients.ts      # connection registry, heartbeat, rate limiting
│   │   ├── rooms.ts        # rooms + DM rooms (dm_<userId>), history
│   │   ├── messages.ts     # validation, broadcast, typing
│   │   ├── discovery.ts    # mDNS advertisement + wifichat.local responder
│   │   ├── types.ts        # server config/types (DEFAULT_CONFIG)
│   │   ├── mdns.d.ts       # untyped mDNS shim
│   │   └── utils/          # logger.ts, crypto.ts (sanitize/validate), network.ts
│   └── tsconfig.json       # outDir dist, rootDir src; @wifichat/shared/* -> ../shared/dist/*
├── client/                 # @wifichat/client, Vite dev on :5173 (host:true)
│   ├── vite.config.ts      # alias @ -> src, @shared -> ../shared; allowedHosts wifichat.local
│   ├── tailwind.config.js / postcss.config.js
│   ├── index.html
│   ├── public/             # favicon.svg, wifi.svg (no fonts/ dir)
│   └── src/
│       ├── main.tsx / App.tsx / index.css
│       ├── components/
│       │   ├── chat/ChatArea.tsx
│       │   ├── sidebar/SidebarContent.tsx
│       │   ├── infoPanel/InfoPanelContent.tsx
│       │   ├── layout/Sidebar.tsx + InfoPanel.tsx
│       │   └── ui/         # Avatar, Button, Dropdown, Input, Logo, Modal, ScrollArea, Separator, Tooltip
│       ├── context/stores.ts + types.ts   # zustand stores (persisted, safeStorage)
│       ├── services/       # websocket.ts, discovery.ts (WebRTC /24 /info scan), storage.ts, crypto.ts, notifications.ts
│       ├── hooks/useMediaQuery.ts
│       ├── utils/dm.ts + messagePreview.ts
│       ├── types/index.ts
│       └── styles/main.css
└── shared/                 # @wifichat/shared, protocol source of truth
    ├── src/types.ts        # User/Message/Room/ServerInfo + ClientPayload/ServerPayload
    └── src/index.ts        # re-exports
```

There is no `server/src/server.ts`, no `client/src/components/modals/`,
no `client/public/fonts/`, and no mDNS browsing on the client.

## Stack

- Server: Node 20+, TypeScript, `ws`, `bonjour-service` + `multicast-dns`,
  `uuid`, `jsonwebtoken`, `winston`. Dev via `tsx watch`, build via `tsc`.
- Client: React 18 + TypeScript, Vite 5, Tailwind, `zustand` (+persist),
  `lucide-react`, `date-fns`, `dompurify`.
- Shared: plain types package, built with `tsc` to `shared/dist`.

## Commands (pnpm 9+ required, Node >= 20)

```bash
pnpm install
pnpm run build          # shared -> server -> client (order matters)
pnpm run build:shared   # must run first: server imports from shared/dist
pnpm run build:server
pnpm run build:client

pnpm run dev            # server + client (concurrently)
pnpm run dev:server     # tsx watch server/src/index.ts
pnpm run dev:client     # vite :5173

pnpm run typecheck      # pnpm -r --if-present typecheck
pnpm run lint           # pnpm -r --if-present lint
pnpm test               # pnpm -r --if-present test (no test suites currently)

# Wrappers (install + build + start):
./run-dev.sh            # or run-dev.bat on Windows
./build.sh              # or build.bat, then: pnpm --filter @wifichat/server start
```

## Ports / discovery

- Server: `http://<host>:3000`, WS at `ws://<host>:3000/ws`, health at
  `GET /info`. Binds `0.0.0.0:3000` for LAN. Serves `client/dist` when built.
- Client dev: `http://localhost:5173` (also reachable via LAN IP / `wifichat.local`).
- Discovery: server advertises `_wifichat._tcp.local` (name `WifiChat`) and
  answers `wifichat.local`. Browser client scans its /24 via WebRTC-derived IP
  (`GET http://<ip>:3000/info`), plus manual `http://<host>:3000` entry.
- Multi-device: build + `pnpm --filter @wifichat/server start` on host, open
  `http://wifichat.local:3000` (fallback: `http://<HOST_LAN_IP>:3000`) elsewhere.

## Protocol (source of truth: `shared/src/types.ts`)

```
Client -> Server: auth {username}, join_room, message {messageType},
  typing, edit_message, delete_message, create_room, rename_room,
  delete_room, reset_server, add_room_members, ping
Server -> Client: auth_ok {userId, token, user, rooms, users}, user_joined,
  user_left, message, history, room_created, room_list, typing, user_status,
  error {code, message}
```

Limits: text <= 4000 chars, attachments <= 2 MB data URLs, ~30 msgs/min/conn.
DMs are on-demand private rooms `dm_<otherUserId>`. Same-username takeover
only kicks dead sessions (prevents kick-wars).

## State (client/src/context/)

- `useAuthStore` - user, token, isAuthenticated (persisted `wifichat-auth`)
- `useRoomsStore` - rooms, activeRoomId
- `useMessagesStore` - messages keyed by roomId
- `useUsersStore` - users, typingUsers
- `useDiscoveryStore` - servers, isScanning, error
- `useUIStore` - sidebarOpen, infoPanelOpen, mobileView (chats|chat|info)
- Types for all stores live in `context/types.ts`, not in the stores file.

## Conventions / gotchas

- Server is ESM + NodeNext: relative imports must use `.js` suffix
  (e.g. `./clients.js`) even though source is `.ts`.
- Server resolves `@wifichat/shared/*` from `../shared/dist/*` — always
  `pnpm run build:shared` first after touching `shared/`.
- Client aliases: `@` -> `client/src`, `@shared` -> `shared/` (vite.config.ts).
- Components: PascalCase.tsx; hooks: `useX.ts`; services: camelCase.ts;
  constants: UPPER_SNAKE_CASE. Client content renders as text, never HTML.
- Never commit: `node_modules/`, `*/dist/`, `*.tsbuildinfo`, `package-lock.json`
  (pnpm is canonical — `pnpm-lock.yaml` only), `.env*`, `*.log`, `.kilo/`.
- `server/dist`, `client/dist`, `shared/dist` are stale-prone build output;
  rebuild rather than editing them (dist may contain files deleted from src).

## Verify

- `pnpm run typecheck` clean, no console errors in browser + server log.
- Two browsers (or host + phone on same Wi-Fi): auth, auto-join General,
  room create/join, DM, typing indicator, history, edit/delete, reconnect.
