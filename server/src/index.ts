import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { DEFAULT_CONFIG, ConnectedClient } from './types.js';
import { clientManager } from './clients.js';
import { roomManager } from './rooms.js';
import { discoveryService, startHostnameResponder } from './discovery.js';
import { generateAuthToken, TokenPayload, validateAuthPayload, createAnonymousUser, verifyToken } from './auth.js';
import { validateMessagePayload, createMessage, broadcastMessage, sendToClient, sendError, sendTypingIndicator } from './messages.js';
import { validateRoomName, sanitizeInput } from './utils/crypto.js';
import { createChildLogger } from './utils/logger.js';
import { getMaxFileSizeMB, getMaxFileBytes, formatFileSize } from './config.js';
import { getLocalIpAddresses, getPrimaryLocalIp } from './utils/network.js';
import { ClientPayload, ServerPayload, User, Room, Message, JoinRoomPayload, MessagePayload, TypingPayload, EditMessagePayload, DeleteMessagePayload, CreateRoomPayload, RenameRoomPayload, DeleteRoomPayload, AddRoomMembersPayload } from '@wifichat/shared/types';

const logger = createChildLogger('server');

const config = { ...DEFAULT_CONFIG, maxFileSizeMB: getMaxFileSizeMB() };

interface ExtendedWebSocket extends WebSocket {
  clientId?: string;
  authenticated?: boolean;
  userId?: string;
}

const pendingPings: Map<string, NodeJS.Timeout> = new Map();

function clearPendingPing(clientId: string): void {
  const pending = pendingPings.get(clientId);
  if (pending) {
    clearTimeout(pending);
    pendingPings.delete(clientId);
  }
}

function joinRoomInternal(clientId: string, userId: string, roomId: string): Room | null {
  let room = roomManager.getRoom(roomId);

  // On-demand DM rooms: `dm_<otherUserId>` resolves to a private room for the pair.
  if (!room && roomId.startsWith('dm_')) {
    const otherUserId = roomId.slice(3);
    const other = clientManager.getClientByUserId(otherUserId);
    if (!other) return null;
    room = roomManager.getOrCreateDMRoom(userId, otherUserId);
  }

  if (!room) return null;

  if (!roomManager.isMember(room.id, userId)) {
    // Private rooms (incl. DMs) only admit existing members or the DM peer.
    if (room.isPrivate && !room.id.startsWith('dm_')) return null;
    roomManager.addMember(room.id, userId);
  }

  clientManager.addClientToRoom(clientId, room.id);
  return room;
}

function handleAuth(ws: ExtendedWebSocket, payload: ClientPayload, clientIp: string): void {
  const validation = validateAuthPayload(payload);
  if (!validation.valid || !validation.username) {
    sendError(ws as any, 'AUTH_FAILED', validation.error || 'Authentication failed');
    return;
  }

  // Same name already online: take over only if the old session looks dead
  // (closed socket or no heartbeat for a while). Kicking a live session
  // would start an endless kick-war between two tabs/devices, each
  // reconnecting and killing the other every few seconds.
  // Exception: the owner reopened the tab and presented their previous
  // session token — same username + valid JWT for the same userId. That
  // proves ownership, so drop the old socket unconditionally and resume
  // the same identity (keeps message ownership, DMs, private rooms).
  const username = validation.username;
  let resumeUserId: string | null = null;
  const presentedToken = (payload as any)?.token;
  if (typeof presentedToken === 'string' && presentedToken) {
    const decoded = verifyToken(presentedToken);
    if (decoded && decoded.username.toLowerCase() === username.toLowerCase()) {
      resumeUserId = decoded.userId;
    }
  }
  const clash = clientManager
    .getAllClients()
    .find((c) => c.user.username.toLowerCase() === username.toLowerCase());
  if (clash) {
    const isOwnerResume = resumeUserId !== null && clash.user.id === resumeUserId;
    if (!isOwnerResume) {
      const idleMs = Date.now() - (clash.lastPing || 0);
      const oldAlive =
        clash.ws.readyState === 1 && idleMs < config.pingInterval + config.pingTimeout;
      if (oldAlive) {
        sendError(
          ws as any,
          'USERNAME_TAKEN',
          `Username is already in use on this network (another tab or device is signed in as "${username}").`
        );
        return;
      }
      logger.info('Username takeover — dropping stale session', {
        username,
        oldClientId: clash.id
      });
    } else {
      logger.info('Identity resume — replacing previous session', {
        username,
        userId: resumeUserId,
        oldClientId: clash.id
      });
    }
    // Best effort: tell the old session why it is being disconnected so it
    // stops auto-reconnecting instead of fighting back.
    sendError(
      clash,
      'SESSION_TAKEOVER',
      'Signed in from another tab or device — this session was disconnected.'
    );
    clearPendingPing(clash.id);
    try {
      clash.ws.terminate();
    } catch {
      // ignore — cleanup below still runs
    }
    handleDisconnect(clash.ws as ExtendedWebSocket);
  }

  const clientId = uuidv4();
  // Resume: same userId the token was minted for, so old messages stay
  // owned by this user and DM/private-room membership still matches.
  const user = createAnonymousUser(validation.username, clientIp, resumeUserId ?? undefined);

  ws.clientId = clientId;
  ws.authenticated = true;
  ws.userId = user.id;

  const client = clientManager.addClient(clientId, ws, user);

  // Every user automatically joins the public General room.
  const defaultRoomId = roomManager.getDefaultRoomId();
  joinRoomInternal(clientId, user.id, defaultRoomId);

  const rooms = roomManager.getUserRooms(user.id);
  const users = clientManager.getOnlineUsers();

  const authOk: ServerPayload = {
    type: 'auth_ok',
    userId: user.id,
    token: generateAuthToken(user),
    user,
    rooms,
    users
  };

  sendToClient(client, authOk);

  logger.info('Client authenticated', { clientId, userId: user.id, username: user.username });

  broadcastUserJoined(user);
  broadcastRoomList();
  discoveryService.updateUserCount(clientManager.getClientCount());
}

function handleJoinRoom(ws: ExtendedWebSocket, payload: ClientPayload): void {
  if (!ws.authenticated || !ws.clientId || !ws.userId) {
    sendError(ws as any, 'NOT_AUTHENTICATED', 'Please authenticate first');
    return;
  }

  const client = clientManager.getClient(ws.clientId);
  if (!client) return;

  const joinPayload = payload as JoinRoomPayload;
  const room = joinRoomInternal(ws.clientId, ws.userId, joinPayload.roomId);
  if (!room) {
    sendError(ws as any, 'ROOM_NOT_FOUND', 'Room not found or access denied');
    return;
  }

  const messages = roomManager.getMessages(room.id);

  const historyPayload: ServerPayload = {
    type: 'history',
    roomId: room.id,
    messages
  };

  sendToClient(client, historyPayload);

  // If the client asked for a `dm_<userId>` alias, tell it the real room too.
  if (room.id !== joinPayload.roomId) {
    const roomCreatedPayload: ServerPayload = {
      type: 'room_created',
      room
    };
    sendToClient(client, roomCreatedPayload);
  }

  broadcastUserJoined(client.user, room.id);

  logger.debug('Client joined room', { clientId: ws.clientId, roomId: room.id });
}

function handleMessage(ws: ExtendedWebSocket, payload: ClientPayload): void {
  if (!ws.authenticated || !ws.clientId || !ws.userId) {
    sendError(ws as any, 'NOT_AUTHENTICATED', 'Please authenticate first');
    return;
  }

  const client = clientManager.getClient(ws.clientId);
  if (!client) return;

  const rateLimit = clientManager.recordMessage(ws.clientId);
  if (!rateLimit.allowed) {
    sendError(ws as any, 'RATE_LIMITED', 'Too many messages, please slow down');
    return;
  }

  const msgPayload = payload as MessagePayload;
  const validation = validateMessagePayload(msgPayload);
  if (!validation.valid || !validation.params) {
    sendError(ws as any, 'INVALID_MESSAGE', validation.error || 'Invalid message');
    return;
  }

  const message = createMessage({
    ...validation.params,
    sender: client.user
  });

  // Sender must be a member of the room to post; auto-join public rooms.
  const room = joinRoomInternal(ws.clientId, ws.userId, msgPayload.roomId);
  if (!room) {
    sendError(ws as any, 'ROOM_NOT_FOUND', 'Room not found or access denied');
    return;
  }
  message.roomId = room.id;

  roomManager.addMessage(room.id, message);

  // Echo to everyone in the room including the sender (delivery confirmation).
  broadcastMessage(message);

  logger.debug('Message broadcast', { messageId: message.id, roomId: room.id });
}

function handleTyping(ws: ExtendedWebSocket, payload: ClientPayload): void {
  if (!ws.authenticated || !ws.clientId || !ws.userId) return;

  const client = clientManager.getClient(ws.clientId);
  if (!client) return;

  const typingPayload = payload as TypingPayload;
  sendTypingIndicator(typingPayload.roomId, ws.userId, client.user.username, typingPayload.isTyping, ws.clientId);
}

function handleCreateRoom(ws: ExtendedWebSocket, payload: ClientPayload): void {
  if (!ws.authenticated || !ws.clientId || !ws.userId) {
    sendError(ws as any, 'NOT_AUTHENTICATED', 'Please authenticate first');
    return;
  }

  const client = clientManager.getClient(ws.clientId);
  if (!client) return;

  const createPayload = payload as CreateRoomPayload;
  const validation = validateRoomName(createPayload.name);
  if (!validation.valid) {
    sendError(ws as any, 'INVALID_ROOM_NAME', validation.error || 'Invalid room name');
    return;
  }

  // Only actually-online users can be added as initial members.
  const memberIds = [...new Set(createPayload.memberIds || [])].filter(
    (id) => typeof id === 'string' && id !== ws.userId && clientManager.getClientByUserId(id)
  );

  const room = roomManager.createRoom({
    name: createPayload.name,
    isPrivate: createPayload.isPrivate,
    createdBy: ws.userId,
    memberIds
  });

  roomManager.addMember(room.id, ws.userId);
  clientManager.addClientToRoom(ws.clientId, room.id);

  const roomCreatedPayload: ServerPayload = {
    type: 'room_created',
    room
  };

  sendToClient(client, roomCreatedPayload);
  
  broadcastRoomList();
  
  logger.info('Room created', { roomId: room.id, name: room.name, creator: ws.userId });
}

function handleRenameRoom(ws: ExtendedWebSocket, payload: ClientPayload): void {
  if (!ws.authenticated || !ws.clientId || !ws.userId) {
    sendError(ws as any, 'NOT_AUTHENTICATED', 'Please authenticate first');
    return;
  }

  const renamePayload = payload as RenameRoomPayload;
  const room = roomManager.getRoom(renamePayload.roomId);
  if (!room) {
    sendError(ws as any, 'ROOM_NOT_FOUND', 'Room not found');
    return;
  }
  // DMs and the default room can never be renamed.
  if (room.id.startsWith('dm_') || room.id === roomManager.getDefaultRoomId()) {
    sendError(ws as any, 'ROOM_PROTECTED', 'This conversation cannot be renamed');
    return;
  }
  if (!roomManager.isMember(room.id, ws.userId)) {
    sendError(ws as any, 'NOT_A_MEMBER', 'Only members can rename this room');
    return;
  }

  const validation = validateRoomName(renamePayload.name);
  if (!validation.valid) {
    sendError(ws as any, 'INVALID_ROOM_NAME', validation.error || 'Invalid room name');
    return;
  }

  roomManager.updateRoomName(room.id, renamePayload.name);
  broadcastRoomList();

  logger.info('Room renamed', { roomId: room.id, name: renamePayload.name, by: ws.userId });
}

/** Invite online users into a room (any member may invite; never DMs). */
function handleAddRoomMembers(ws: ExtendedWebSocket, payload: ClientPayload): void {
  if (!ws.authenticated || !ws.clientId || !ws.userId) {
    sendError(ws as any, 'NOT_AUTHENTICATED', 'Please authenticate first');
    return;
  }

  const addPayload = payload as AddRoomMembersPayload;
  const room = roomManager.getRoom(addPayload.roomId);
  if (!room) {
    sendError(ws as any, 'ROOM_NOT_FOUND', 'Room not found');
    return;
  }
  if (room.id.startsWith('dm_')) {
    sendError(ws as any, 'ROOM_PROTECTED', 'Members cannot be added to direct messages');
    return;
  }
  if (!roomManager.isMember(room.id, ws.userId)) {
    sendError(ws as any, 'NOT_A_MEMBER', 'Only members can invite to this room');
    return;
  }

  const ids = [...new Set(addPayload.memberIds || [])]
    .filter((id) => typeof id === 'string')
    .slice(0, 20);
  for (const id of ids) {
    if (!clientManager.getClientByUserId(id)) continue;
    roomManager.addMember(room.id, id);
  }
  broadcastRoomList();

  logger.info('Room members added', { roomId: room.id, by: ws.userId, count: ids.length });
}

function handleDeleteRoom(ws: ExtendedWebSocket, payload: ClientPayload): void {  if (!ws.authenticated || !ws.clientId || !ws.userId) {
    sendError(ws as any, 'NOT_AUTHENTICATED', 'Please authenticate first');
    return;
  }

  const deletePayload = payload as DeleteRoomPayload;
  const room = roomManager.getRoom(deletePayload.roomId);
  if (!room) {
    sendError(ws as any, 'ROOM_NOT_FOUND', 'Room not found');
    return;
  }
  // Anyone may delete anything (including DMs and General — deleting
  // General recreates it fresh).

  // Detach the room from every connected client's join state first.
  for (const client of clientManager.getClientsInRoom(room.id)) {
    clientManager.removeClientFromRoom(client.id, room.id);
  }
  roomManager.deleteRoom(room.id);

  broadcastRoomDeleted(room.id);
  broadcastRoomList();

  logger.info('Room deleted', { roomId: room.id, name: room.name, by: ws.userId });
}

function handleResetServer(ws: ExtendedWebSocket): void {
  if (!ws.authenticated || !ws.clientId || !ws.userId) {
    sendError(ws as any, 'NOT_AUTHENTICATED', 'Please authenticate first');
    return;
  }

  // Wipe every room, DM and message; everyone lands back in a fresh General.
  roomManager.reset();
  for (const client of clientManager.getAllClients()) {
    client.rooms.clear();
  }

  const payload: ServerPayload = {
    type: 'server_reset',
    rooms: roomManager.getPublicRooms()
  };
  const data = JSON.stringify(payload);
  for (const client of clientManager.getAllClients()) {
    if (client.ws.readyState === 1) {
      try {
        client.ws.send(data);
      } catch (error) {
        logger.debug('Failed to send server_reset', { clientId: client.id });
      }
    }
  }

  logger.info('Server reset — all rooms and messages cleared', { by: ws.userId });
}

function handleEditMessage(ws: ExtendedWebSocket, payload: ClientPayload): void {
  if (!ws.authenticated || !ws.clientId || !ws.userId) {
    sendError(ws as any, 'NOT_AUTHENTICATED', 'Please authenticate first');
    return;
  }

  const editPayload = payload as EditMessagePayload;
  const room = roomManager.getRoom(editPayload.roomId);
  if (!room) {
    sendError(ws as any, 'ROOM_NOT_FOUND', 'Room not found');
    return;
  }
  if (!roomManager.isMember(room.id, ws.userId)) {
    sendError(ws as any, 'NOT_A_MEMBER', 'You are not a member of this room');
    return;
  }

  const existing = roomManager.getMessages(room.id, 500).find((m) => m.id === editPayload.messageId);
  if (!existing) {
    sendError(ws as any, 'MESSAGE_NOT_FOUND', 'Message not found');
    return;
  }
  // Only the sender can edit (any of their messages, incl. attachments).
  if (existing.senderId !== ws.userId) {
    sendError(ws as any, 'NOT_MESSAGE_OWNER', 'You can only edit your own messages');
    return;
  }
  if (typeof editPayload.content !== 'string' || !editPayload.content.trim()) {
    sendError(ws as any, 'INVALID_MESSAGE', 'Message content is required');
    return;
  }

  const updated = editPayload.content.startsWith('data:')
    ? roomManager.editMessage(room.id, existing.id, editPayload.content, editPayload.metadata)
    : editPayload.content.length > 4000
      ? null
      : roomManager.editMessage(room.id, existing.id, sanitizeInput(editPayload.content, 4000));
  if (!updated) {
    sendError(ws as any, 'INVALID_MESSAGE', 'Could not edit message');
    return;
  }

  const out: ServerPayload = { type: 'message_edited', message: updated };
  const data = JSON.stringify(out);
  for (const client of clientManager.getClientsInRoom(room.id)) {
    if (client.ws.readyState === 1) {
      try {
        client.ws.send(data);
      } catch (error) {
        logger.debug('Failed to send message_edited', { clientId: client.id });
      }
    }
  }

  logger.debug('Message edited', { messageId: updated.id, roomId: room.id });
}

function handleDeleteMessage(ws: ExtendedWebSocket, payload: ClientPayload): void {
  if (!ws.authenticated || !ws.clientId || !ws.userId) {
    sendError(ws as any, 'NOT_AUTHENTICATED', 'Please authenticate first');
    return;
  }

  const deletePayload = payload as DeleteMessagePayload;
  const room = roomManager.getRoom(deletePayload.roomId);
  if (!room) {
    sendError(ws as any, 'ROOM_NOT_FOUND', 'Room not found');
    return;
  }
  if (!roomManager.isMember(room.id, ws.userId)) {
    sendError(ws as any, 'NOT_A_MEMBER', 'You are not a member of this room');
    return;
  }

  const existing = roomManager.getMessages(room.id, 500).find((m) => m.id === deletePayload.messageId);
  if (!existing) {
    sendError(ws as any, 'MESSAGE_NOT_FOUND', 'Message not found');
    return;
  }
  // Only the sender can delete their message.
  if (existing.senderId !== ws.userId) {
    sendError(ws as any, 'NOT_MESSAGE_OWNER', 'You can only delete your own messages');
    return;
  }

  const { deleted, lastMessage } = roomManager.deleteMessage(room.id, existing.id);
  if (!deleted) {
    sendError(ws as any, 'MESSAGE_NOT_FOUND', 'Message not found');
    return;
  }

  const out: ServerPayload = {
    type: 'message_deleted',
    roomId: room.id,
    messageId: existing.id,
    lastMessage
  };
  const data = JSON.stringify(out);
  for (const client of clientManager.getClientsInRoom(room.id)) {
    if (client.ws.readyState === 1) {
      try {
        client.ws.send(data);
      } catch (error) {
        logger.debug('Failed to send message_deleted', { clientId: client.id });
      }
    }
  }

  logger.debug('Message deleted', { messageId: existing.id, roomId: room.id });
}

function broadcastUserJoined(user: User, roomId?: string): void {
  const payload: ServerPayload = {
    type: 'user_joined',
    user,
    roomId: roomId || ''
  };
  
  const data = JSON.stringify(payload);
  
  const clients = roomId 
    ? clientManager.getClientsInRoom(roomId)
    : clientManager.getAllClients();
  
  for (const client of clients) {
    if (client.ws.readyState === 1) {
      try {
        client.ws.send(data);
      } catch (error) {
        logger.debug('Failed to send user_joined', { clientId: client.id });
      }
    }
  }
}

function broadcastUserLeft(userId: string, roomId?: string): void {
  const payload: ServerPayload = {
    type: 'user_left',
    userId,
    roomId: roomId || ''
  };
  
  const data = JSON.stringify(payload);
  
  const clients = roomId 
    ? clientManager.getClientsInRoom(roomId)
    : clientManager.getAllClients();
  
  for (const client of clients) {
    if (client.ws.readyState === 1) {
      try {
        client.ws.send(data);
      } catch (error) {
        logger.debug('Failed to send user_left', { clientId: client.id });
      }
    }
  }
}

function broadcastRoomList(): void {
  // Each client only sees public rooms plus its own private rooms/DMs —
  // DM rooms are created on demand (when clicking a user) and never leak
  // to anyone outside the pair.
  for (const client of clientManager.getAllClients()) {
    if (client.ws.readyState === 1) {
      try {
        const payload: ServerPayload = {
          type: 'room_list',
          rooms: roomManager.getVisibleRooms(client.user.id)
        };
        client.ws.send(JSON.stringify(payload));
      } catch (error) {
        logger.debug('Failed to send room_list', { clientId: client.id });
      }
    }
  }
}

function broadcastRoomDeleted(roomId: string): void {
  const payload: ServerPayload = {
    type: 'room_deleted',
    roomId
  };

  const data = JSON.stringify(payload);

  for (const client of clientManager.getAllClients()) {
    if (client.ws.readyState === 1) {
      try {
        client.ws.send(data);
      } catch (error) {
        logger.debug('Failed to send room_deleted', { clientId: client.id });
      }
    }
  }
}

function handleDisconnect(ws: ExtendedWebSocket): void {
  if (!ws.clientId) return;

  clearPendingPing(ws.clientId);
  const client = clientManager.removeClient(ws.clientId);
  if (client) {
    for (const roomId of client.rooms) {
      // Private rooms and DMs keep their member list so a reconnect with
      // the same identity (same userId via resume token) lands back in
      // them. Public rooms drop the member — anyone can rejoin freely.
      const room = roomManager.getRoom(roomId);
      if (!room?.isPrivate) {
        roomManager.removeMember(roomId, client.user.id);
      }
      broadcastUserLeft(client.user.id, roomId);
    }
    
    broadcastRoomList();
    discoveryService.updateUserCount(clientManager.getClientCount());
    
    logger.info('Client disconnected', { clientId: ws.clientId, userId: client.user.id });
  }
}

function handlePong(ws: ExtendedWebSocket): void {
  if (ws.clientId) {
    clientManager.updateClientActivity(ws.clientId);
    // Client answered in time — cancel its scheduled termination.
    clearPendingPing(ws.clientId);
  }
}

function setupWebSocketServer(server: http.Server): WebSocketServer {
  // Allow one max-size file per frame plus JSON overhead; larger frames are
  // rejected by `ws` before they can exhaust memory.
  const maxPayload = Math.ceil(getMaxFileBytes() * 1.6) + 1024 * 1024;
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload });
  
  wss.on('connection', (ws: ExtendedWebSocket, req) => {
    const clientIp = req.socket.remoteAddress || 'unknown';
    logger.debug('New WebSocket connection', { ip: clientIp });
    
    ws.on('message', (data) => {
      try {
        const payload = JSON.parse(data.toString()) as ClientPayload;

        switch (payload.type) {
          case 'auth':
            handleAuth(ws, payload, clientIp);
            break;
          case 'join_room':
            handleJoinRoom(ws, payload);
            break;
          case 'message':
            handleMessage(ws, payload);
            break;
          case 'edit_message':
            handleEditMessage(ws, payload);
            break;
          case 'delete_message':
            handleDeleteMessage(ws, payload);
            break;
          case 'typing':
            handleTyping(ws, payload);
            break;
          case 'create_room':
            handleCreateRoom(ws, payload);
            break;
          case 'rename_room':
            handleRenameRoom(ws, payload);
            break;
          case 'delete_room':
            handleDeleteRoom(ws, payload);
            break;
          case 'add_room_members':
            handleAddRoomMembers(ws, payload);
            break;
          case 'reset_server':
            handleResetServer(ws);
            break;
          case 'ping':
            if (ws.clientId) clientManager.updateClientActivity(ws.clientId);
            break;
          default:
            logger.warn('Unknown payload type', { type: (payload as any).type });
        }
      } catch (error) {
        logger.error('Failed to parse message', { error: (error as Error).message });
        sendError(ws as any, 'PARSE_ERROR', 'Invalid message format');
      }
    });
    
    ws.on('pong', () => handlePong(ws));
    
    ws.on('close', () => handleDisconnect(ws));
    
    ws.on('error', (error) => {
      logger.error('WebSocket error', { error: error.message });
    });
  });
  
  return wss;
}

function startPingInterval(wss: WebSocketServer): void {
  setInterval(() => {
    for (const client of clientManager.getAllClients()) {
      if (client.ws.readyState === 1) {
        try {
          // Reset any previous pending timeout before scheduling a new one.
          clearPendingPing(client.id);
          client.ws.ping();
          
          const timeout = setTimeout(() => {
            logger.debug('Ping timeout, closing connection', { clientId: client.id });
            client.ws.terminate();
          }, config.pingTimeout);
          
          pendingPings.set(client.id, timeout);
        } catch (error) {
          logger.debug('Ping failed', { clientId: client.id, error: (error as Error).message });
        }
      }
    }
  }, config.pingInterval);
}

function setupCleanupInterval(): void {
  // A client is only stale if it missed several heartbeats. Terminating the
  // socket (instead of silently forgetting it) lets the close handler run,
  // so rooms, broadcasts and user counts stay consistent.
  const staleAfterMs = config.pingInterval * 2 + config.pingTimeout;
  setInterval(() => {
    let removed = 0;
    for (const client of clientManager.getAllClients()) {
      if (Date.now() - client.lastPing > staleAfterMs) {
        clearPendingPing(client.id);
        try {
          client.ws.terminate();
        } catch {
          // ignore — close handler still cleans up
        }
        removed++;
      }
    }
    if (removed > 0) {
      discoveryService.updateUserCount(clientManager.getClientCount());
      logger.info('Cleaned up stale clients', { removed });
    }
  }, 60000);
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

function resolveClientDir(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, '../../client/dist'),
    path.resolve(here, '../../../client/dist'),
    path.resolve(process.cwd(), '../client/dist'),
    path.resolve(process.cwd(), 'client/dist')
  ];
  for (const dir of candidates) {
    try {
      if (fs.existsSync(path.join(dir, 'index.html'))) return dir;
    } catch {
      // ignore
    }
  }
  return null;
}

async function startServer(): Promise<void> {
  const clientDir = resolveClientDir();

  const httpServer = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', 'http://localhost');

    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        clients: clientManager.getClientCount(),
        rooms: roomManager.getAllRooms().length,
        uptime: process.uptime()
      }));
      return;
    }

    if (url.pathname === '/info') {
      const localIps = getLocalIpAddresses();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: discoveryService.getServerInfo()?.id || 'wifichat-server',
        name: 'WifiChat Server',
        version: '1.0.0',
        host: getPrimaryLocalIp() || 'localhost',
        port: config.httpPort,
        wsPort: config.httpPort,
        localIps,
        userCount: clientManager.getClientCount(),
        users: clientManager.getClientCount(),
        rooms: roomManager.getAllRooms().length
      }));
      return;
    }

    // Serve the built client UI so LAN devices just open http://<host>:3000
    if (clientDir && req.method === 'GET') {
      try {
        let filePath = path.normalize(path.join(clientDir, decodeURIComponent(url.pathname)));
        if (!filePath.startsWith(clientDir)) {
          res.writeHead(403);
          res.end('Forbidden');
          return;
        }
        if (url.pathname === '/' || url.pathname === '') filePath = path.join(clientDir, 'index.html');
        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          filePath = path.join(clientDir, 'index.html');
        }
        if (fs.existsSync(filePath)) {
          const ext = path.extname(filePath).toLowerCase();
          res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
          fs.createReadStream(filePath).pipe(res);
          return;
        }
      } catch {
        // fall through to 404
      }
    }

    res.writeHead(404);
    res.end('Not Found');
  });
  
  const wss = setupWebSocketServer(httpServer);
  startPingInterval(wss);
  setupCleanupInterval();

  // mDNS is best-effort: another WifiChat server on this machine/network
  // may already own the name. The app must still boot (HTTP + WebSocket +
  // LAN /info scan keep working); discovery just won't advertise from here.
  try {
    await discoveryService.startAdvertising(config.httpPort, config.wsPort, 0);
  } catch (error) {
    logger.warn('mDNS advertising unavailable — continuing without it', {
      error: (error as Error).message
    });
  }
  try {
    await discoveryService.startBrowsing();
  } catch (error) {
    logger.warn('mDNS browsing unavailable — continuing without it', {
      error: (error as Error).message
    });
  }
  
  httpServer.listen(config.httpPort, config.host, () => {
    const localIps = getLocalIpAddresses();
    logger.info('WifiChat Server started', {
      httpPort: config.httpPort,
      wsPort: config.wsPort,
      host: config.host,
      maxFileSizeMB: config.maxFileSizeMB,
      localIps
    });
    
    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║                    WifiChat Server                          ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║  App + API:    http://localhost:${config.httpPort}                      ║`);
    console.log(`║  WebSocket:    ws://localhost:${config.httpPort}/ws                    ║`);
    console.log('║                                                              ║');
    console.log('║  Other devices on this Wi-Fi: open                         ║');
    for (const ip of localIps) {
      console.log(`║    http://${ip}:${config.httpPort}                                      ║`);
    }
    console.log(`║  Short name:  http://wifichat.local:${config.httpPort} (same Wi-Fi)        ║`);
    console.log(`║  Max file:   ${formatFileSize(config.maxFileSizeMB)} (pnpm dev --file-size <MB>)          ║`);
    const primaryIp = getPrimaryLocalIp();
    if (primaryIp) startHostnameResponder(primaryIp);
    if (clientDir) console.log('║  Serving client UI from client/dist                          ║');
    else console.log('║  (client/dist not built - API only)                          ║');
    console.log('║                                                              ║');
    console.log('║  mDNS Service: WifiChat._wifichat._tcp.local.             ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');
  });
  
  process.on('SIGINT', async () => {
    logger.info('Shutting down server...');
    await discoveryService.stopAdvertising();
    discoveryService.stopBrowsing();
    discoveryService.destroy();
    httpServer.close();
    process.exit(0);
  });
}

startServer().catch((error) => {
  logger.error('Failed to start server', { error: error.message });
  process.exit(1);
});