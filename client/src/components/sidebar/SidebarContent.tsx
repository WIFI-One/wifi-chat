import React, { useEffect, useRef, useState } from 'react';
import { Plus, Wifi, WifiOff, LogOut, RefreshCw, Bell, BellOff, Pencil, Trash2, Check, X, Search } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Avatar } from '../ui/Avatar';
import { Logo } from '../ui/Logo';
import { Modal } from '../ui/Modal';
import { ScrollArea } from '../ui/ScrollArea';
import {
  useAuthStore,
  useRoomsStore,
  useMessagesStore,
  useUsersStore,
  useDiscoveryStore,
  useUIStore
} from '../../context/stores';
import { discoveryService, normalizeBaseUrl, isLoopbackHost } from '../../services/discovery';
import { websocketService } from '../../services/websocket';
import { requestNotificationPermission, notificationsSupported } from '../../services/notifications';
import { getDmPeerId, resolveDmPeerName, rememberDmPeer } from '../../utils/dm';
import { messagePreview, mediaKindLabel } from '../../utils/messagePreview';
import { settingsStorage } from '../../services/storage';
import { formatTimestamp } from '../../services/crypto';
import { User, Room, ServerInfo } from '@wifichat/shared/types';

// Module-level guard: on mobile two SidebarContent instances mount at once —
// only one of them may attempt the automatic connect.
let globalAutoConnectTried = false;

/**
 * The server address this page itself was served from (host UI), or the
 * matching :3000 address when on the :5173 dev page. This address provably
 * answers HTTP from this device, so it beats any saved/guessed address.
 */
function pageServerUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const { origin, hostname, port } = window.location;
  if (!origin.startsWith('http')) return null;
  const normalized = normalizeBaseUrl(
    port && port !== '3000' ? `http://${hostname}:3000` : origin
  );
  return normalized;
}

function isDevPage(): boolean {
  if (typeof window === 'undefined') return false;
  const { origin, port } = window.location;
  return origin.startsWith('http') && !!port && port !== '3000';
}

/**
 * Best initial server address so "Join Chat" is usable immediately:
 * page origin (host serves the UI — always reachable) > saved server >
 * :3000 on the dev-page host > empty (user picks from scan results).
 */
function defaultServerUrl(): string {
  const page = pageServerUrl();
  if (page && !isDevPage()) return page;
  const last = settingsStorage.getLastServer();
  if (last) return last;
  if (page) return page;
  return '';
}

export const SidebarContent: React.FC = () => {
  const { user } = useAuthStore();
  const { rooms, activeRoomId } = useRoomsStore();
  const { users } = useUsersStore();
  const { servers, isScanning } = useDiscoveryStore();
  const { setMobileView } = useUIStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateRoom, setShowCreateRoom] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomPrivate, setNewRoomPrivate] = useState(false);
  const [newRoomMembers, setNewRoomMembers] = useState<string[]>([]);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isProbing, setIsProbing] = useState(false);
  const [username, setUsername] = useState(() => settingsStorage.getLastUsername());
  const [serverUrl, setServerUrl] = useState(() => defaultServerUrl());
  const [error, setError] = useState<string | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [connected, setConnected] = useState(websocketService.connected);
  const [notifOn, setNotifOn] = useState(() => settingsStorage.getNotifications());
  const [lanOnline, setLanOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine
  );

  const scannedRef = useRef(false);
  const autoTriedRef = useRef(false);
  // Set once the user picks/types a server themselves — auto-select must not
  // overwrite their choice afterwards.
  const serverTouchedRef = useRef(false);

  // LAN reachability indicator (offline Wi-Fi still counts as LAN).
  useEffect(() => {
    const onOnline = () => setLanOnline(true);
    const onOffline = () => setLanOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    return websocketService.onConnectionChange(setConnected);
  }, []);

  // Surface a "signed in elsewhere" kick once the login screen is showing.
  useEffect(() => {
    if (!user) {
      const notice = websocketService.consumeKickNotice();
      if (notice) setError(notice);
    }
  }, [user]);

  // Scan the LAN once when the login screen mounts.
  useEffect(() => {
    if (user || scannedRef.current) return;
    scannedRef.current = true;
    discoveryService.startScanning().catch(() => {});
  }, [user]);

  // Auto-connect once with saved credentials.
  useEffect(() => {
    if (user || autoTriedRef.current || globalAutoConnectTried) return;
    const lastServer = settingsStorage.getLastServer();
    const lastUsername = settingsStorage.getLastUsername();
    if (lastServer && lastUsername) {
      autoTriedRef.current = true;
      globalAutoConnectTried = true;
      void handleConnect(lastUsername, lastServer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Auto-select the most recently seen server while the field is still empty
  // so "Join Chat" becomes enabled on its own after a scan. Real LAN
  // addresses win over loopback ones (localhost answers on every device,
  // including ones with no server).
  useEffect(() => {
    if (user || serverTouchedRef.current || serverUrl.trim() || servers.length === 0) return;
    const sorted = [...servers].sort((a, b) => {
      const loop = Number(isLoopbackHost(a.host)) - Number(isLoopbackHost(b.host));
      if (loop !== 0) return loop;
      return (b.lastSeen ?? 0) - (a.lastSeen ?? 0);
    });
    const first = sorted[0];
    if (first) setServerUrl(`http://${first.host}:${first.port}`);
  }, [user, servers, serverUrl]);

  const handleConnect = async (name?: string, url?: string, attempt = 1) => {
    const finalName = (name ?? username).trim();
    const finalUrl = normalizeBaseUrl(url ?? serverUrl) ?? '';
    if (!finalName || !finalUrl) {
      setError('Enter a username and pick a server (or type its address).');
      return;
    }
    // Resume the stored identity only when rejoining with the same name —
    // otherwise the server mints a fresh user (prevents id hijacking).
    const stored = useAuthStore.getState();
    const resumeToken =
      stored.user?.username.toLowerCase() === finalName.toLowerCase()
        ? stored.token
        : null;

    setIsConnecting(true);
    setError(null);
    setFailedUrl(null);
    try {
      try {
        await websocketService.connect(finalUrl);
      } catch {
        // Reachability failure (nothing answering at this address).
        setFailedUrl(finalUrl);
        setError(
          `Couldn't reach ${finalUrl} — the host's Wi-Fi address may have changed. Pick a server above or use this page's address.`
        );
        return;
      }
      const authed = websocketService.waitForAuthResult();
      websocketService.auth(finalName, resumeToken);
      try {
        await authed;
      } catch (err) {
        // Reopened tab right after closing the old one: the server may
        // still see the previous session as alive. Wait for it to time out
        // and try once more before surfacing the error.
        // (With a resume token the server replaces the stale session
        // immediately, so this path is mostly for token-less joins.)
        const taken = err instanceof Error && /already in use/i.test(err.message);
        if (!taken || attempt > 1) throw err;
        await new Promise((r) => setTimeout(r, 4000));
        try {
          await websocketService.connect(finalUrl);
        } catch {
          setFailedUrl(finalUrl);
          setError(
            `Couldn't reach ${finalUrl} — the host's Wi-Fi address may have changed. Pick a server above or use this page's address.`
          );
          return;
        }
        const retry = websocketService.waitForAuthResult();
        websocketService.auth(finalName, resumeToken);
        await retry;
      }
      settingsStorage.setLastServer(finalUrl);
      settingsStorage.setLastUsername(finalName);
      setServerUrl(finalUrl);
      setUsername(finalName);
      setMobileView('chat');
      // Ask for notification permission now (user gesture) so incoming
      // messages can pop a system notification.
      void requestNotificationPermission();
    } catch (err) {
      // Auth/validation failure (server answered, but refused the login).
      setError(err instanceof Error ? err.message : 'Failed to connect.');
    } finally {
      setIsConnecting(false);
    }
  };

  const pageUrl = pageServerUrl();
  const showPageFallback =
    !!failedUrl && !!pageUrl && failedUrl !== pageUrl && !!username.trim();

  const handleUsePageAddress = () => {
    if (!pageUrl || !username.trim()) return;
    serverTouchedRef.current = true;
    setServerUrl(pageUrl);
    setError(null);
    setFailedUrl(null);
    void handleConnect(username.trim(), pageUrl);
  };

  const handleProbeManual = async () => {
    const normalized = normalizeBaseUrl(serverUrl);
    if (!normalized) {
      setError('Enter a server address like http://192.168.1.50:3000');
      return;
    }
    setIsProbing(true);
    setError(null);
    try {
      const info = await discoveryService.probeUrl(normalized);
      if (!info) setError('No WifiChat server answered at that address.');
    } catch {
      setError('No WifiChat server answered at that address.');
    } finally {
      setIsProbing(false);
    }
  };

  const handleDisconnect = () => {
    websocketService.disconnect();
    useAuthStore.getState().logout();
    useRoomsStore.getState().setRooms([]);
    useRoomsStore.getState().setActiveRoom(null);
    useMessagesStore.getState().clearAllMessages();
    autoTriedRef.current = true; // don't auto-reconnect after manual disconnect
    globalAutoConnectTried = true;
  };

  const toggleNotifications = () => {
    const next = !notifOn;
    setNotifOn(next);
    settingsStorage.setNotifications(next);
    if (next) void requestNotificationPermission();
  };

  const closeCreateRoom = () => {
    setShowCreateRoom(false);
    setNewRoomName('');
    setNewRoomPrivate(false);
    setNewRoomMembers([]);
  };

  const handleCreateRoom = () => {
    if (!newRoomName.trim()) return;
    websocketService.createRoom(newRoomName.trim(), newRoomPrivate, newRoomMembers);
    closeCreateRoom();
  };

  const toggleNewRoomMember = (id: string) => {
    setNewRoomMembers((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
  };

  const openDM = (other: User) => {
    // Server resolves `dm_<userId>` to a real private room on join.
    rememberDmPeer(other);
    useRoomsStore.getState().setActiveRoom(`dm_${other.id}`);
    websocketService.joinRoom(`dm_${other.id}`);
    setMobileView('chat');
  };

  const q = searchQuery.toLowerCase();
  const groupRooms = rooms.filter(
    (room: Room) => !room.id.startsWith('dm_') && room.name.toLowerCase().includes(q)
  );
  const dmRooms = rooms.filter((room: Room) => {
    if (!room.id.startsWith('dm_')) return false;
    if (!q) return true;
    const peerName = resolveDmPeerName(room, users, user?.id) ?? room.name;
    return peerName.toLowerCase().includes(q);
  });
  const filteredUsers = users.filter(
    (u: User) => u.id !== user?.id && u.username.toLowerCase().includes(q)
  );

  const handleResetAll = () => {
    if (
      confirm(
        'Reset the whole server? This deletes ALL rooms, DMs and messages for everyone. This cannot be undone.'
      )
    ) {
      websocketService.resetServer();
    }
  };

  if (!user) {
    return (
      <div className="flex flex-col h-full p-4 overflow-y-auto">
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-4">
            <Logo size="md" />
            <div>
              <h1 className="text-xl font-semibold text-white">WifiChat</h1>
              <p className="text-sm text-white/50">Local Network Messenger</p>
            </div>
          </div>
          <div
            className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg border ${
              lanOnline
                ? 'text-green-400 border-green-500/20 bg-green-500/5'
                : 'text-yellow-400 border-yellow-500/20 bg-yellow-500/5'
            }`}
          >
            {lanOnline ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
            {lanOnline ? 'Local Network: reachable' : 'No internet — LAN chat still works'}
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-white/70 mb-2">Username</label>
            <Input
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setFailedUrl(null);
              }}
              placeholder="Enter your name"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && void handleConnect()}
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-white/70">Server</label>
              <button
                onClick={() => void discoveryService.startScanning()}
                className="text-xs text-white/50 hover:text-white flex items-center gap-1"
                disabled={isScanning}
              >
                <RefreshCw className={`w-3 h-3 ${isScanning ? 'animate-spin' : ''}`} />
                {isScanning ? 'Scanning LAN…' : 'Rescan'}
              </button>
            </div>
            {isScanning && servers.length === 0 ? (
              <p className="text-sm text-white/40 px-1 py-2 animate-pulse">
                Searching local network…
              </p>
            ) : servers.length > 0 ? (
              <div className="space-y-2">
                {servers.map((server: ServerInfo) => (
                  <button
                    key={`${server.host}:${server.port}`}
                    onClick={() => {
                      serverTouchedRef.current = true;
                      setServerUrl(`http://${server.host}:${server.port}`);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors ${
                      serverUrl === `http://${server.host}:${server.port}`
                        ? 'border-white/40 bg-white/10'
                        : 'border-white/10 bg-white/5 hover:bg-neutral-800'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-white text-sm truncate">{server.name}</p>
                      <p className="text-xs text-white/50">
                        {server.host}:{server.port} • {server.userCount} online
                      </p>
                    </div>
                    <Wifi className="w-4 h-4 text-green-400 flex-shrink-0" />
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-white/40 px-1 py-2">
                No servers found yet. Make sure the host runs <code className="text-white/60">pnpm run dev:server</code> on
                this Wi-Fi — or type its address below.
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-white/70 mb-2">
              Server address (manual)
            </label>
            <div className="flex gap-2">
              <Input
                value={serverUrl}
                onChange={(e) => {
                  serverTouchedRef.current = true;
                  setServerUrl(e.target.value);
                  setFailedUrl(null);
                }}
                placeholder="http://192.168.1.50:3000"
                onKeyDown={(e) => e.key === 'Enter' && void handleConnect()}
              />
              <Button variant="secondary" onClick={() => void handleProbeManual()} disabled={isProbing}>
                {isProbing ? '…' : 'Find'}
              </Button>
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-400 text-center" role="alert">
              {error}
            </p>
          )}
          {showPageFallback && (
            <Button
              variant="secondary"
              className="w-full"
              onClick={handleUsePageAddress}
              disabled={isConnecting}
            >
              Use this page's address instead
            </Button>
          )}

          <Button
            className="w-full"
            onClick={() => void handleConnect()}
            disabled={isConnecting || !username.trim() || !serverUrl.trim()}
          >
            {isConnecting ? 'Connecting…' : 'Join Chat'}
          </Button>
          {!isConnecting && (!username.trim() || !serverUrl.trim()) && (
            <p className="text-xs text-white/40 text-center">
              {!username.trim()
                ? 'Enter a username above to join.'
                : 'Pick a discovered server or type its address to join.'}
            </p>
          )}
        </div>

        <div className="mt-auto pt-4">
          <p className="text-xs text-white/40 text-center">
            Messages stay on your local network. No cloud, no tracking.
          </p>
        </div>
      </div>
    );
  }

  const onlineCount = users.filter((u) => u.status === 'online' || u.status === 'typing').length;

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-chat-border">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <Logo size="sm" />
            <div className="min-w-0">
              <h1 className="text-lg font-semibold text-white truncate">WifiChat</h1>
              <p className="text-xs text-white/50 flex items-center gap-1">
                <span
                  className={`inline-block w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`}
                />
                {connected ? `${onlineCount} online` : 'reconnecting…'}
              </p>
            </div>
          </div>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 pointer-events-none" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search conversations…"
            className="pl-9"
          />
        </div>
      </div>

      <ScrollArea className="flex-1 overflow-y-auto">
        <div className="p-4 space-y-1">
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-xs font-medium text-white/40 uppercase tracking-wider">
              Rooms ({groupRooms.length})
            </span>
            <Button variant="ghost" size="sm" onClick={() => setShowCreateRoom(true)} aria-label="Create room">
              <Plus className="w-4 h-4" />
            </Button>
          </div>

          {groupRooms.length === 0 ? (
            <div className="px-2 py-4 text-center text-white/30 text-sm">
              No rooms yet. Create one to start chatting!
            </div>
          ) : (
            groupRooms.map((room: Room) => (
              <RoomItem key={room.id} room={room} isActive={activeRoomId === room.id} />
            ))
          )}

          {dmRooms.length > 0 && (
          <div className="pt-4">
            <div className="px-2 py-1 mb-2">
              <span className="text-xs font-medium text-white/40 uppercase tracking-wider">
                Direct Messages ({dmRooms.length})
              </span>
            </div>

            {dmRooms.map((room: Room) => (
              <DmRoomItem key={room.id} room={room} myId={user?.id} activeRoomId={activeRoomId} />
            ))}
          </div>
          )}

          <div className="pt-4">
            <div className="px-2 py-1 mb-2">
              <span className="text-xs font-medium text-white/40 uppercase tracking-wider">
                People ({filteredUsers.length})
              </span>
            </div>

            {filteredUsers.length === 0 ? (
              <div className="px-2 py-4 text-center text-white/30 text-sm">
                No other users online
              </div>
            ) : (
              filteredUsers.map((u: User) => (
                <button
                  key={u.id}
                  onClick={() => openDM(u)}
                  className={`w-full sidebar-item ${activeRoomId === `dm_${u.id}` ? 'sidebar-item-active' : ''}`}
                >
                  <Avatar name={u.username} size="md" status={u.status === 'typing' ? 'online' : u.status} />
                  <div className="flex-1 min-w-0 text-left">
                    <p className="font-medium text-white truncate">{u.username}</p>
                    <p className="text-sm text-white/50 truncate">
                      {u.status === 'typing' ? 'typing…' : u.status === 'online' ? 'Online' : 'Offline'}
                    </p>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </ScrollArea>

      <div className="p-4 border-t border-chat-border space-y-2">
        <p className="text-xs text-white/40 truncate px-1">
          {user.username} • {websocketService.serverUrl || 'local server'}
        </p>
        <Button variant="secondary" className="w-full justify-start" onClick={handleDisconnect}>
          <LogOut className="w-4 h-4 mr-2" />
          Disconnect
        </Button>
        {notificationsSupported() && (
          <Button
            variant="ghost"
            className="w-full justify-start"
            onClick={toggleNotifications}
            aria-pressed={notifOn}
            aria-label={notifOn ? 'Mute message notifications' : 'Unmute message notifications'}
          >
            {notifOn ? <Bell className="w-4 h-4 mr-2" /> : <BellOff className="w-4 h-4 mr-2" />}
            Notifications {notifOn ? 'on' : 'off'}
          </Button>
        )}
        <Button
          variant="danger"
          className="w-full justify-start"
          onClick={handleResetAll}
          title="Delete every room, DM and message on this server"
        >
          <Trash2 className="w-4 h-4 mr-2" />
          Reset everything
        </Button>
      </div>

      <Modal
        isOpen={showCreateRoom}
        onClose={closeCreateRoom}
        title="Create room"
        size="sm"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-white/70 mb-2">Room name</label>
            <Input
              value={newRoomName}
              onChange={(e) => setNewRoomName(e.target.value)}
              placeholder="Room name (e.g. Gaming Room)"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleCreateRoom()}
            />
          </div>
          <div className="rounded-lg border border-white/10 bg-white/5 p-3">
            <label className="flex items-center gap-2 text-sm text-white/80 cursor-pointer">
              <input
                type="checkbox"
                checked={newRoomPrivate}
                onChange={(e) => setNewRoomPrivate(e.target.checked)}
                className="accent-white"
              />
              Private room
            </label>
            <p className="text-xs text-white/50 mt-2 leading-relaxed">
              Private rooms are hidden — only invited members can see them,
              join them, or read their messages. Public rooms are visible to
              everyone on this Wi-Fi and anyone can join.
            </p>
          </div>
          {users.filter((u: User) => u.id !== user?.id).length > 0 && (
            <div>
              <p className="text-sm font-medium text-white/70 mb-2">
                Add members <span className="text-white/40">(optional)</span>
              </p>
              <div className="max-h-32 overflow-y-auto space-y-1">
                {users
                  .filter((u: User) => u.id !== user?.id)
                  .map((u: User) => (
                    <label
                      key={u.id}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-white/80 hover:bg-neutral-800 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={newRoomMembers.includes(u.id)}
                        onChange={() => toggleNewRoomMember(u.id)}
                        className="accent-white"
                      />
                      <Avatar name={u.username} size="sm" status={u.status === 'typing' ? 'online' : u.status} />
                      <span className="truncate">{u.username}</span>
                    </label>
                  ))}
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={closeCreateRoom}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={handleCreateRoom} disabled={!newRoomName.trim()}>
              Create
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

const RoomItem: React.FC<{ room: Room; isActive: boolean }> = ({ room, isActive }) => {
  const { setActiveRoom } = useRoomsStore();
  const { setMobileView } = useUIStore();
  const { typingUsers, users } = useUsersStore();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(room.name);
  const typingSet = typingUsers[room.id];
  const typingNames = typingSet
    ? Array.from(typingSet)
        .map((id) => users.find((u) => u.id === id)?.username)
        .filter(Boolean)
        .slice(0, 2)
    : [];

  const previewMediaKind =
    !typingNames.length && room.lastMessage ? mediaKindLabel(room.lastMessage) : null;
  const preview =
    typingNames.length > 0
      ? `${typingNames.join(', ')} typing…`
      : !room.lastMessage
        ? `${room.members.length} member${room.members.length === 1 ? '' : 's'}`
        : previewMediaKind
          ? null
          : `${room.lastMessage.senderName}: ${room.lastMessage.content}`;

  // System-owned rooms (General) can't be renamed.
  // Rooms are deleted from the info panel. DM rooms never render here.
  const canManage = room.createdBy !== 'system';

  const saveRename = () => {
    const name = draft.trim();
    setEditing(false);
    setDraft(room.name);
    if (name && name !== room.name) websocketService.renameRoom(room.id, name);
  };

  return (
    <button
      onClick={() => {
        if (editing) return;
        setActiveRoom(room.id);
        websocketService.joinRoom(room.id);
        setMobileView('chat');
      }}
      className={`w-full sidebar-item group ${isActive ? 'sidebar-item-active' : ''}`}
      aria-current={isActive ? 'true' : 'false'}
    >
      <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0">
        <span className="text-sm font-semibold text-white/80">
          {room.name.slice(0, 2).toUpperCase()}
        </span>
      </div>
      <div className="flex-1 min-w-0 text-left">
        <div className="flex items-center justify-between gap-2">
          {editing ? (
            <input
              value={draft}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') saveRename();
                if (e.key === 'Escape') {
                  setEditing(false);
                  setDraft(room.name);
                }
              }}
              onBlur={saveRename}
              maxLength={60}
              aria-label="Room name"
              className="flex-1 min-w-0 px-1.5 py-0.5 bg-white/10 border border-white/20 rounded text-white text-sm font-medium focus:outline-none"
            />
          ) : (
            <p className="font-medium text-white truncate">{room.name}</p>
          )}
          {editing ? (
            <span className="flex items-center gap-1 flex-shrink-0">
              <span
                role="button"
                tabIndex={0}
                aria-label="Save room name"
                onClick={(e) => {
                  e.stopPropagation();
                  saveRename();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.stopPropagation();
                    saveRename();
                  }
                }}
                className="p-1 rounded hover:bg-neutral-700 text-green-400"
              >
                <Check className="w-3.5 h-3.5" />
              </span>
              <span
                role="button"
                tabIndex={0}
                aria-label="Cancel rename"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditing(false);
                  setDraft(room.name);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.stopPropagation();
                    setEditing(false);
                    setDraft(room.name);
                  }
                }}
                className="p-1 rounded hover:bg-neutral-700 text-white/60"
              >
                <X className="w-3.5 h-3.5" />
              </span>
            </span>
          ) : (
            <span className="flex items-center gap-1 flex-shrink-0">
              {room.lastMessage && (
                <span className="text-[11px] text-white/40 flex-shrink-0">
                  {formatTimestamp(room.lastMessage.timestamp)}
                </span>
              )}
              {canManage && (
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={`Rename ${room.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setDraft(room.name);
                      setEditing(true);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.stopPropagation();
                        setDraft(room.name);
                        setEditing(true);
                      }
                    }}
                    className="p-1 rounded hover:bg-neutral-700 text-white/40 hover:text-white opacity-0 group-hover:opacity-100 focus:opacity-100 transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </span>
              )}
            </span>
          )}
        </div>
        <p className="text-sm text-white/50 truncate">
          {previewMediaKind && room.lastMessage ? (
            <>{room.lastMessage.senderName}: <i>Sent {previewMediaKind}</i></>
          ) : (
            preview
          )}
        </p>
      </div>
    </button>
  );
};

const DmRoomItem: React.FC<{ room: Room; myId?: string; activeRoomId: string | null }> = ({
  room,
  myId,
  activeRoomId
}) => {
  const { setActiveRoom } = useRoomsStore();
  const { setMobileView } = useUIStore();
  const { typingUsers, users } = useUsersStore();

  const peerId = getDmPeerId(room, myId);
  const peer = peerId ? users.find((u: User) => u.id === peerId) : undefined;
  const displayName = resolveDmPeerName(room, users, myId) ?? room.name;
  // Also highlight when the unresolved `dm_<userId>` alias is active.
  const isActive = activeRoomId === room.id || (peerId !== null && activeRoomId === `dm_${peerId}`);

  const typingSet = typingUsers[room.id];
  const isPeerTyping = peerId !== null && typingSet?.has(peerId);
  const previewMediaKind =
    !isPeerTyping && room.lastMessage ? mediaKindLabel(room.lastMessage) : null;
  const preview = isPeerTyping
    ? 'typing…'
    : room.lastMessage
      ? previewMediaKind
        ? null
        : messagePreview(room.lastMessage)
      : peer
        ? peer.status === 'online' || peer.status === 'typing'
          ? 'Online'
          : 'Offline'
        : 'Tap to chat';

  return (
    <button
      onClick={() => {
        if (peer) rememberDmPeer(peer);
        setActiveRoom(room.id);
        websocketService.joinRoom(room.id);
        setMobileView('chat');
      }}
      className={`w-full sidebar-item group ${isActive ? 'sidebar-item-active' : ''}`}
      aria-current={isActive ? 'true' : 'false'}
    >
      <Avatar
        name={displayName}
        size="md"
        status={peer ? (peer.status === 'typing' ? 'online' : peer.status) : undefined}
      />
      <div className="flex-1 min-w-0 text-left">
        <div className="flex items-center justify-between gap-2">
          <p className="font-medium text-white truncate">{displayName}</p>
          {room.lastMessage && (
            <span className="text-[11px] text-white/40 flex-shrink-0">
              {formatTimestamp(room.lastMessage.timestamp)}
            </span>
          )}
        </div>
        <p className="text-sm text-white/50 truncate">
          {previewMediaKind ? <i>Sent {previewMediaKind}</i> : preview}
        </p>
      </div>
      </button>
  );
};
