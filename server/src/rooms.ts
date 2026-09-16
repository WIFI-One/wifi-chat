import { Room, Message, User } from '@wifichat/shared/types';
import { generateSessionId } from './utils/crypto.js';
import { createChildLogger } from './utils/logger.js';

const logger = createChildLogger('rooms');

export class RoomManager {
  private rooms: Map<string, Room> = new Map();
  private roomMessages: Map<string, Message[]> = new Map();
  private dmIndex: Map<string, string> = new Map();
  private maxHistoryPerRoom = 500;
  private defaultRoomId: string;

  constructor() {
    const general = this.createRoom({
      name: 'General',
      isPrivate: false,
      createdBy: 'system'
    });
    this.defaultRoomId = general.id;
  }

  getDefaultRoomId(): string {
    return this.defaultRoomId;
  }

  getDefaultRoom(): Room | undefined {
    return this.rooms.get(this.defaultRoomId);
  }

  /** Get or create a private 1-to-1 room for two users. Stable id for the pair. */
  getOrCreateDMRoom(userIdA: string, userIdB: string): Room {
    const key = [userIdA, userIdB].sort().join(':');
    const existingId = this.dmIndex.get(key);
    if (existingId) {
      const existing = this.rooms.get(existingId);
      if (existing) return existing;
    }
    const room: Room = {
      id: `dm_${generateSessionId()}`,
      name: 'Direct Message',
      isPrivate: true,
      createdBy: userIdA,
      createdAt: Date.now(),
      members: [userIdA, userIdB],
      unreadCount: 0
    };
    this.rooms.set(room.id, room);
    this.roomMessages.set(room.id, []);
    this.dmIndex.set(key, room.id);
    logger.info('DM room created', { roomId: room.id });
    return room;
  }

  createRoom(params: { name: string; isPrivate: boolean; createdBy: string; memberIds?: string[] }): Room {
    // 'system' is a pseudo-creator, never a real member — counting it would
    // inflate member counts (e.g. General showing 2 members for 1 user).
    const members = [...(params.memberIds ?? []), params.createdBy].filter(
      (id, i, arr) => id !== 'system' && arr.indexOf(id) === i
    );
    const room: Room = {
      id: `room_${generateSessionId()}`,
      name: params.name.trim(),
      isPrivate: params.isPrivate,
      createdBy: params.createdBy,
      createdAt: Date.now(),
      members,
      unreadCount: 0
    };
    
    this.rooms.set(room.id, room);
    this.roomMessages.set(room.id, []);
    
    logger.info('Room created', { roomId: room.id, name: room.name, isPrivate: room.isPrivate });
    return room;
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  getAllRooms(): Room[] {
    return Array.from(this.rooms.values());
  }

  getPublicRooms(): Room[] {
    return Array.from(this.rooms.values()).filter(r => !r.isPrivate);
  }

  /**
   * Rooms a user may see: all public rooms plus the private rooms/DMs
   * they belong to. DMs never leak to outsiders through room lists.
   */
  getVisibleRooms(userId: string): Room[] {
    return Array.from(this.rooms.values()).filter(
      (r) => !r.isPrivate || r.members.includes(userId)
    );
  }

  getUserRooms(userId: string): Room[] {
    return Array.from(this.rooms.values()).filter(r => r.members.includes(userId));
  }

  addMember(roomId: string, userId: string): boolean {
    const room = this.rooms.get(roomId);
    if (room && !room.members.includes(userId)) {
      room.members.push(userId);
      return true;
    }
    return false;
  }

  removeMember(roomId: string, userId: string): boolean {
    const room = this.rooms.get(roomId);
    if (room) {
      const index = room.members.indexOf(userId);
      if (index !== -1) {
        room.members.splice(index, 1);
        return true;
      }
    }
    return false;
  }

  isMember(roomId: string, userId: string): boolean {
    const room = this.rooms.get(roomId);
    return room?.members.includes(userId) ?? false;
  }

  addMessage(roomId: string, message: Message): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    
    const messages = this.roomMessages.get(roomId) || [];
    messages.push(message);
    
    if (messages.length > this.maxHistoryPerRoom) {
      messages.shift();
    }
    
    room.lastMessage = message;
    room.unreadCount++;
    
    return true;
  }

  getMessages(roomId: string, limit: number = 100): Message[] {
    const messages = this.roomMessages.get(roomId) || [];
    return messages.slice(-limit);
  }

  /** Update a message's content (sets the edited flag). Media stays media. */
  editMessage(roomId: string, messageId: string, content: string, metadata?: Message['metadata']): Message | null {
    const messages = this.roomMessages.get(roomId);
    const message = messages?.find((m) => m.id === messageId);
    if (!message) return null;
    if (content.startsWith('data:')) {
      message.content = content;
      message.metadata = metadata;
      const mime = metadata?.mimeType ?? '';
      message.type =
        mime.startsWith('image/') || content.startsWith('data:image/') ? 'image' : 'file';
    } else {
      message.content = content;
      message.type = 'text';
      message.metadata = undefined;
    }
    message.edited = true;
    const room = this.rooms.get(roomId);
    if (room?.lastMessage?.id === messageId) room.lastMessage = message;
    return message;
  }

  /** Remove a message; recomputes the room preview afterwards. */
  deleteMessage(roomId: string, messageId: string): { deleted: boolean; lastMessage?: Message } {
    const messages = this.roomMessages.get(roomId);
    if (!messages) return { deleted: false };
    const index = messages.findIndex((m) => m.id === messageId);
    if (index === -1) return { deleted: false };
    messages.splice(index, 1);
    const room = this.rooms.get(roomId);
    const lastMessage = messages.length ? messages[messages.length - 1] : undefined;
    if (room) room.lastMessage = lastMessage;
    return { deleted: true, lastMessage };
  }

  getMessageHistory(roomId: string, beforeTimestamp: number, limit: number = 50): Message[] {
    const messages = this.roomMessages.get(roomId) || [];
    const filtered = messages.filter(m => m.timestamp < beforeTimestamp);
    return filtered.slice(-limit);
  }

  markAsRead(roomId: string, userId: string): void {
    const room = this.rooms.get(roomId);
    if (room) {
      room.unreadCount = Math.max(0, room.unreadCount - 1);
    }
  }

  deleteRoom(roomId: string): boolean {
    const deleted = this.rooms.delete(roomId);
    this.roomMessages.delete(roomId);
    if (!deleted) return false;
    // Drop stale DM pair mappings for the removed room.
    for (const [key, id] of this.dmIndex) {
      if (id === roomId) this.dmIndex.delete(key);
    }
    // Deleting General recreates it fresh so the default room always exists.
    if (roomId === this.defaultRoomId) {
      const general = this.createRoom({
        name: 'General',
        isPrivate: false,
        createdBy: 'system'
      });
      this.defaultRoomId = general.id;
    }
    logger.info('Room deleted', { roomId });
    return true;
  }

  /** Wipe every room, DM and message; start over with a fresh General. */
  reset(): void {
    this.rooms.clear();
    this.roomMessages.clear();
    this.dmIndex.clear();
    const general = this.createRoom({
      name: 'General',
      isPrivate: false,
      createdBy: 'system'
    });
    this.defaultRoomId = general.id;
    logger.info('Room state reset — all rooms and messages cleared');
  }

  updateRoomName(roomId: string, name: string): boolean {
    const room = this.rooms.get(roomId);
    if (room) {
      room.name = name.trim();
      return true;
    }
    return false;
  }

  getRoomMemberCount(roomId: string): number {
    const room = this.rooms.get(roomId);
    return room?.members.length ?? 0;
  }
}

export const roomManager = new RoomManager();