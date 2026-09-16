import { Message, MessageType, User } from '@wifichat/shared/types';
import { sanitizeInput, validateRoomName } from './utils/crypto.js';
import { roomManager } from './rooms.js';
import { clientManager } from './clients.js';
import { ConnectedClient } from './types.js';
import { createChildLogger } from './utils/logger.js';

import type { WebSocket } from 'ws';

type SendableSocket = Pick<WebSocket, 'send' | 'readyState'>;
type SendTarget = ConnectedClient | SendableSocket;

function rawSocketOf(target: SendTarget): SendableSocket | null {
  if (!target) return null;
  if (typeof (target as ConnectedClient).ws !== 'undefined') {
    return (target as ConnectedClient).ws as SendableSocket;
  }
  return target as SendableSocket;
}

const logger = createChildLogger('messages');

const MAX_TEXT_LENGTH = 4000;

export interface SendMessageParams {
  sender: User;
  roomId: string;
  content: string;
  type: MessageType;
  metadata?: Message['metadata'];
}

export function createMessage(params: SendMessageParams): Message {
  // Text gets fully sanitized; media passes through untouched (truncating
  // or stripping characters would corrupt the base64 data URL) after the
  // length/prefix checks in validateMessagePayload.
  const content =
    params.type === 'image' || params.type === 'file'
      ? params.content
      : sanitizeInput(params.content, MAX_TEXT_LENGTH);

  return {
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    roomId: params.roomId,
    senderId: params.sender.id,
    senderName: params.sender.username,
    content,
    type: params.type,
    timestamp: Date.now(),
    status: 'sent',
    metadata: params.metadata
  };
}

export function validateMessagePayload(payload: any): { valid: boolean; error?: string; params?: SendMessageParams } {
  if (!payload || typeof payload !== 'object') {
    return { valid: false, error: 'Invalid payload' };
  }
  
  if (payload.type !== 'message') {
    return { valid: false, error: 'Expected message payload' };
  }
  
  if (!payload.roomId || typeof payload.roomId !== 'string') {
    return { valid: false, error: 'Room ID is required' };
  }
  
  if (!payload.content || typeof payload.content !== 'string') {
    return { valid: false, error: 'Message content is required' };
  }

  const validTypes: MessageType[] = ['text', 'image', 'file', 'system'];
  if (!validTypes.includes(payload.messageType)) {
    return { valid: false, error: 'Invalid message type' };
  }

  const isMedia = payload.messageType === 'image' || payload.messageType === 'file';
  if (!isMedia && payload.content.length > MAX_TEXT_LENGTH) {
    return { valid: false, error: `Message too long (max ${MAX_TEXT_LENGTH} characters)` };
  }

  if (isMedia) {
    // Media must be a data URL — this keeps the large size allowance from
    // being abused for giant plain-text posts.
    if (!payload.content.startsWith('data:')) {
      return { valid: false, error: 'Media content must be a data URL' };
    }
    const metaError = validateFileMetadata(payload.metadata);
    if (metaError) return { valid: false, error: metaError };
  }
  
  const room = roomManager.getRoom(payload.roomId);
  if (!room) {
    return { valid: false, error: 'Room not found' };
  }
  
  return { 
    valid: true, 
    params: {
      sender: { id: '', username: '' } as User,
      roomId: payload.roomId,
      content: payload.content,
      type: payload.messageType,
      metadata: payload.metadata
    }
  };
}

function validateFileMetadata(metadata: unknown): string | null {
  if (metadata === undefined) return null;
  if (!metadata || typeof metadata !== 'object') return 'Invalid file metadata';
  const meta = metadata as Record<string, unknown>;
  if (meta.fileName !== undefined) {
    if (typeof meta.fileName !== 'string' || meta.fileName.length > 255) {
      return 'Invalid file name';
    }
  }
  if (meta.fileSize !== undefined) {
    if (typeof meta.fileSize !== 'number' || !Number.isFinite(meta.fileSize) || meta.fileSize < 0) {
      return 'Invalid file size';
    }
  }
  if (meta.mimeType !== undefined && typeof meta.mimeType !== 'string') {
    return 'Invalid mime type';
  }
  return null;
}

export function broadcastMessage(message: Message, excludeClientId?: string): number {
  const clients = clientManager.getClientsInRoom(message.roomId);
  let sentCount = 0;
  
  const payload = {
    type: 'message',
    message
  };
  
  const data = JSON.stringify(payload);
  
  for (const client of clients) {
    if (client.id === excludeClientId) continue;
    
    if (client.ws.readyState === 1) {
      try {
        client.ws.send(data);
        sentCount++;
      } catch (error) {
        logger.error('Failed to send message to client', { 
          clientId: client.id, 
          error: (error as Error).message 
        });
      }
    }
  }
  
  return sentCount;
}

export function sendToClient(target: SendTarget, payload: unknown): boolean {
  const ws = rawSocketOf(target);
  if (!ws || ws.readyState !== 1) return false;

  try {
    ws.send(JSON.stringify(payload));
    return true;
  } catch (error) {
    logger.error('Failed to send to client', {
      error: (error as Error).message
    });
    return false;
  }
}

export function sendError(target: SendTarget, code: string, message: string): void {
  sendToClient(target, {
    type: 'error',
    code,
    message
  });
}

export function sendTypingIndicator(roomId: string, userId: string, userName: string, isTyping: boolean, excludeClientId?: string): void {
  const clients = clientManager.getClientsInRoom(roomId);
  const payload = {
    type: 'typing',
    userId,
    userName,
    roomId,
    isTyping
  };
  
  const data = JSON.stringify(payload);
  
  for (const client of clients) {
    if (client.id === excludeClientId) continue;
    if (client.ws.readyState === 1) {
      try {
        client.ws.send(data);
      } catch (error) {
        logger.debug('Failed to send typing indicator', { clientId: client.id });
      }
    }
  }
}