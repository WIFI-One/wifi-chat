import { ClientPayload, ServerPayload, Message, Room } from '@wifichat/shared/types';
import { rememberDmPeer } from '../utils/dm';
import { messagePreview } from '../utils/messagePreview';
import { notifyChatMessage } from './notifications';
import { useAuthStore } from '../context/stores';
import { useRoomsStore } from '../context/stores';
import { useMessagesStore } from '../context/stores';
import { useUsersStore } from '../context/stores';
import { useUIStore } from '../context/stores';

type MessageHandler = (payload: ServerPayload) => void;
type ConnectionListener = (connected: boolean) => void;

function toWsUrl(serverUrl: string): string {
  const trimmed = serverUrl.trim().replace(/\/+$/, '');
  if (/^wss?:\/\//i.test(trimmed)) return `${trimmed}/ws`;
  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `http://${trimmed}`);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = '/ws';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return `ws://${trimmed}/ws`;
  }
}

class WebSocketService {
  private ws: WebSocket | null = null;
  private url = '';
  private serverBaseUrl = '';
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private reconnectTimer: number | null = null;
  private handlers: Set<MessageHandler> = new Set();
  private connectionListeners: Set<ConnectionListener> = new Set();
  private pingInterval: number | null = null;
  private isIntentionalClose = false;
  private messageQueue: ClientPayload[] = [];
  // Set when the server kicks this session (signed in elsewhere): auto-reconnect
  // must stay off or the two sessions would kill each other in a loop.
  private sessionKicked = false;
  private kickMessage: string | null = null;

  /** Take-and-clear the pending "signed in elsewhere" notice, if any. */
  consumeKickNotice(): string | null {
    const msg = this.kickMessage;
    this.kickMessage = null;
    return msg;
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  get serverUrl(): string {
    return this.serverBaseUrl;
  }

  connect(serverUrl: string): Promise<void> {
    this.disconnect();
    this.url = toWsUrl(serverUrl);
    this.serverBaseUrl = serverUrl.trim().replace(/\/+$/, '');
    this.isIntentionalClose = false;
    this.sessionKicked = false;
    this.reconnectAttempts = 0;

    return new Promise((resolve, reject) => {
      let settled = false;
      try {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          this.reconnectAttempts = 0;
          this.startPing();
          this.flushQueue();
          this.emitConnection(true);
          if (!settled) {
            settled = true;
            resolve();
          }
        };

        this.ws.onmessage = (event) => {
          try {
            const payload = JSON.parse(
              typeof event.data === 'string' ? event.data : ''
            ) as ServerPayload;
            if (payload && typeof payload.type === 'string') this.handleMessage(payload);
          } catch (error) {
            console.error('[WS] Failed to parse message:', error);
          }
        };

        this.ws.onclose = () => {
          this.stopPing();
          this.emitConnection(false);
          if (!this.isIntentionalClose) this.scheduleReconnect();
          if (!settled) {
            settled = true;
            reject(new Error('Connection closed before opening'));
          }
        };

        this.ws.onerror = () => {
          if (!settled) {
            settled = true;
            reject(new Error('WebSocket connection failed'));
          }
        };
      } catch (error) {
        if (!settled) reject(error as Error);
      }
    });
  }

  private handleMessage(payload: ServerPayload): void {
    switch (payload.type) {
      case 'auth_ok': {
        useAuthStore.getState().setUser(payload.user);
        useAuthStore.getState().setToken(payload.token);
        useRoomsStore.getState().setRooms(payload.rooms);
        useUsersStore.getState().setUsers(payload.users);
        payload.users.forEach(rememberDmPeer);
        // Drop cached messages for rooms the server no longer knows
        // (e.g. after a server restart with a fresh room list).
        const knownIds = new Set(payload.rooms.map((r: Room) => r.id));
        const cached = useMessagesStore.getState().messages;
        for (const roomId of Object.keys(cached)) {
          if (!knownIds.has(roomId)) {
            useMessagesStore.getState().clearMessages(roomId);
          }
        }
        // (Re)join the active conversation on every auth — not just the first
        // login. A reconnect mints a new session that the server doesn't know
        // yet; without this the user silently misses all new messages.
        const rooms = payload.rooms;
        const activeId = useRoomsStore.getState().activeRoomId;
        const target =
          (activeId && rooms.some((r: Room) => r.id === activeId)
            ? activeId
            : (rooms.find((r: Room) => r.name === 'General') || rooms[0])?.id) || null;
        if (target) {
          useRoomsStore.getState().setActiveRoom(target);
          this.joinRoom(target);
        }
        break;
      }

      case 'user_joined': {
        useUsersStore.getState().addUser(payload.user);
        rememberDmPeer(payload.user);
        if (payload.roomId) {
          const rooms = useRoomsStore.getState().rooms;
          const room = rooms.find((r: Room) => r.id === payload.roomId);
          if (room && !room.members.includes(payload.user.id)) {
            useRoomsStore.getState().updateRoom(payload.roomId, {
              members: [...room.members, payload.user.id]
            });
          }
        }
        break;
      }

      case 'user_left': {
        useUsersStore.getState().removeUser(payload.userId);
        if (payload.roomId) {
          const room = useRoomsStore.getState().rooms.find((r: Room) => r.id === payload.roomId);
          if (room) {
            useRoomsStore.getState().updateRoom(payload.roomId, {
              members: room.members.filter((id) => id !== payload.userId)
            });
          }
        }
        break;
      }

      case 'message': {
        const store = useMessagesStore.getState();
        const existing = (store.messages[payload.message.roomId] || []).some(
          (m) => m.id === payload.message.id
        );
        if (!existing) {
          store.addMessage(payload.message.roomId, payload.message);
          useRoomsStore.getState().updateRoom(payload.message.roomId, {
            lastMessage: payload.message
          });
          // Notify for messages from others that arrive in the background.
          const me = useAuthStore.getState().user;
          if (me && payload.message.senderId !== me.id) {
            const rooms = useRoomsStore.getState().rooms;
            const room = rooms.find((r: Room) => r.id === payload.message.roomId);
            const activeId = useRoomsStore.getState().activeRoomId;
            const viewing = !document.hidden && activeId === payload.message.roomId;
            notifyChatMessage({
              senderName: payload.message.senderName,
              roomName: room?.name ?? 'WifiChat',
              isDM: room?.id.startsWith('dm_') ?? false,
              preview: messagePreview(payload.message),
              roomId: payload.message.roomId,
              background: !viewing,
              onOpen: (roomId) => {
                useRoomsStore.getState().setActiveRoom(roomId);
                this.joinRoom(roomId);
                useUIStore.getState().setMobileView('chat');
              }
            });
          }
        }
        break;
      }

      case 'message_edited': {
        useMessagesStore.getState().editMessage(
          payload.message.roomId,
          payload.message.id,
          payload.message.content
        );
        const editedRoom = useRoomsStore.getState().rooms.find(
          (r: Room) => r.id === payload.message.roomId
        );
        if (editedRoom?.lastMessage?.id === payload.message.id) {
          useRoomsStore.getState().updateRoom(payload.message.roomId, {
            lastMessage: payload.message
          });
        }
        break;
      }

      case 'message_deleted': {
        useMessagesStore.getState().deleteMessage(payload.roomId, payload.messageId);
        useRoomsStore.getState().updateRoom(payload.roomId, {
          lastMessage: payload.lastMessage
        });
        break;
      }

      case 'history':
        useMessagesStore.getState().setMessages(payload.roomId, payload.messages);
        break;

      case 'room_created': {
        const rooms = useRoomsStore.getState().rooms;
        if (!rooms.some((r: Room) => r.id === payload.room.id)) {
          useRoomsStore.getState().addRoom(payload.room);
        }
        break;
      }

      case 'room_list':
        useRoomsStore.getState().setRooms(payload.rooms);
        // The room we were viewing may have been deleted (or the server
        // restarted). Fall back to General — but never clobber a pending
        // `dm_<userId>` alias that hasn't resolved to a real room yet.
        {
          const activeId = useRoomsStore.getState().activeRoomId;
          if (!activeId) {
            const target =
              payload.rooms.find((r: Room) => r.name === 'General') || payload.rooms[0];
            if (target) {
              useRoomsStore.getState().setActiveRoom(target.id);
              this.joinRoom(target.id);
            }
          } else if (!activeId.startsWith('dm_') && !payload.rooms.some((r: Room) => r.id === activeId)) {
            const fallback = payload.rooms.find((r: Room) => r.name === 'General') || payload.rooms[0];
            useMessagesStore.getState().clearMessages(activeId);
            useRoomsStore.getState().setActiveRoom(fallback?.id ?? null);
            if (fallback) this.joinRoom(fallback.id);
          }
        }
        break;

      case 'room_deleted': {
        const rooms = useRoomsStore.getState();
        if (rooms.rooms.some((r: Room) => r.id === payload.roomId)) {
          rooms.removeRoom(payload.roomId);
        }
        useMessagesStore.getState().clearMessages(payload.roomId);
        if (useRoomsStore.getState().activeRoomId === payload.roomId) {
          const remaining = useRoomsStore.getState().rooms;
          const fallback = remaining.find((r: Room) => r.name === 'General') || remaining[0];
          useRoomsStore.getState().setActiveRoom(fallback?.id ?? null);
          if (fallback) this.joinRoom(fallback.id);
        }
        break;
      }

      case 'server_reset': {
        // Whole database wiped: drop every cached message and land in General.
        useMessagesStore.getState().clearAllMessages();
        useRoomsStore.getState().setRooms(payload.rooms);
        const general =
          payload.rooms.find((r: Room) => r.name === 'General') || payload.rooms[0];
        useRoomsStore.getState().setActiveRoom(general?.id ?? null);
        if (general) this.joinRoom(general.id);
        break;
      }

      case 'typing':
        useUsersStore.getState().setTyping(payload.roomId, payload.userId, payload.isTyping);
        useUsersStore.getState().updateUserStatus(
          payload.userId,
          payload.isTyping ? 'typing' : 'online'
        );
        break;

      case 'user_status':
        useUsersStore.getState().updateUserStatus(payload.userId, payload.status);
        break;

      case 'error':
        if (payload.code === 'SESSION_TAKEOVER') {
          // Signed in from another tab/device: go back to the login screen
          // and STAY there. Reconnecting would kick the other session and
          // start an endless war.
          this.sessionKicked = true;
          this.kickMessage = payload.message;
          this.disconnect();
          useAuthStore.getState().logout();
          useRoomsStore.getState().setRooms([]);
          useRoomsStore.getState().setActiveRoom(null);
          useMessagesStore.getState().clearAllMessages();
        } else {
          console.error('[WS] Server error:', payload.code, payload.message);
        }
        break;
    }

    this.handlers.forEach((handler) => handler(payload));
  }

  send(payload: ClientPayload): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    } else {
      this.messageQueue.push(payload);
    }
  }

  private flushQueue(): void {
    while (this.messageQueue.length > 0) {
      const payload = this.messageQueue.shift()!;
      this.send(payload);
    }
  }

  private startPing(): void {
    this.stopPing();
    this.pingInterval = window.setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 25000);
  }

  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.isIntentionalClose || this.sessionKicked) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('[WS] Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(
      this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1),
      30000
    );

    console.log(`[WS] Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts})`);

    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = window.setTimeout(() => {
      if (this.isIntentionalClose || this.sessionKicked) return;
      // Re-authenticate as the same user so identity survives a blip.
      const username = useAuthStore.getState().user?.username;
      this.connect(this.serverBaseUrl)
        .then(() => {
          if (username) this.auth(username);
        })
        .catch(() => {});
    }, delay);
  }

  disconnect(): void {
    this.isIntentionalClose = true;
    this.stopPing();
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.onclose = null;
        this.ws.close(1000, 'Intentional disconnect');
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.messageQueue = [];
    this.emitConnection(false);
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  onConnectionChange(listener: ConnectionListener): () => void {
    this.connectionListeners.add(listener);
    return () => {
      this.connectionListeners.delete(listener);
    };
  }

  /**
   * Resolve on the next `auth_ok`, reject on the next `error`.
   * Used to detect login failures (e.g. USERNAME_TAKEN right after a tab
   * close, while the server still sees the old session as alive).
   */
  waitForAuthResult(timeoutMs = 8000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        unsub();
        reject(new Error('Login timed out — is the server still running?'));
      }, timeoutMs);
      const unsub = this.onMessage((payload: ServerPayload) => {
        if (payload.type === 'auth_ok') {
          clearTimeout(timer);
          unsub();
          resolve();
        } else if (payload.type === 'error') {
          clearTimeout(timer);
          unsub();
          reject(new Error(payload.message));
        }
      });
    });
  }

  private emitConnection(connected: boolean): void {
    this.connectionListeners.forEach((l) => l(connected));
  }

  auth(username: string): void {
    this.send({ type: 'auth', username });
  }

  joinRoom(roomId: string): void {
    this.send({ type: 'join_room', roomId });
  }

  sendMessage(
    roomId: string,
    content: string,
    messageType: Message['type'] = 'text',
    metadata?: Message['metadata']
  ): void {
    this.send({ type: 'message', roomId, content, messageType, metadata });
  }

  /** Send a file as a base64 message (no size cap). */
  async sendFile(roomId: string, file: File): Promise<void> {
    const content = await fileToDataUrl(file);
    const kind: Message['type'] = file.type.startsWith('image/') ? 'image' : 'file';
    this.sendMessage(roomId, content, kind, {
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type
    });
  }

  setTyping(roomId: string, isTyping: boolean): void {
    this.send({ type: 'typing', roomId, isTyping });
  }

  createRoom(name: string, isPrivate: boolean, memberIds?: string[]): void {
    this.send({ type: 'create_room', name, isPrivate, memberIds });
  }

  addRoomMembers(roomId: string, memberIds: string[]): void {
    this.send({ type: 'add_room_members', roomId, memberIds });
  }

  renameRoom(roomId: string, name: string): void {
    this.send({ type: 'rename_room', roomId, name });
  }

  deleteRoom(roomId: string): void {
    this.send({ type: 'delete_room', roomId });
  }

  /** Wipe all rooms, DMs and messages on the server (everyone is affected). */
  resetServer(): void {
    this.send({ type: 'reset_server' });
  }

  editMessage(roomId: string, messageId: string, content: string, metadata?: Message['metadata']): void {
    this.send({ type: 'edit_message', roomId, messageId, content, metadata });
  }

  deleteMessage(roomId: string, messageId: string): void {
    this.send({ type: 'delete_message', roomId, messageId });
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

/** Read any file as a base64 data URL (no size cap). */
export function fileToDataUrl(file: File): Promise<string> {
  return readFileAsDataUrl(file);
}

export const websocketService = new WebSocketService();
