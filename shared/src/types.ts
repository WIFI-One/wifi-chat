export type MessageType = 'text' | 'image' | 'file' | 'system';

export type UserStatus = 'online' | 'away' | 'offline' | 'typing';

export interface User {
  id: string;
  username: string;
  avatar?: string;
  status: UserStatus;
  ipAddress?: string;
  lastSeen: number;
  isLocal?: boolean;
}

export interface Message {
  id: string;
  roomId: string;
  senderId: string;
  senderName: string;
  content: string;
  type: MessageType;
  timestamp: number;
  status: 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
  edited?: boolean;
  metadata?: {
    fileName?: string;
    fileSize?: number;
    mimeType?: string;
  };
}

export interface Room {
  id: string;
  name: string;
  isPrivate: boolean;
  createdBy: string;
  createdAt: number;
  members: string[];
  lastMessage?: Message;
  unreadCount: number;
}

export interface ServerInfo {
  id: string;
  name: string;
  host: string;
  port: number;
  wsPort: number;
  userCount: number;
  version: string;
  lastSeen: number;
}

export interface AuthPayload {
  type: 'auth';
  username: string;
  token?: string;
  roomId?: string;
}

export interface JoinRoomPayload {
  type: 'join_room';
  roomId: string;
}

export interface MessagePayload {
  type: 'message';
  roomId: string;
  content: string;
  messageType: MessageType;
  metadata?: Message['metadata'];
}

export interface TypingPayload {
  type: 'typing';
  roomId: string;
  isTyping: boolean;
}

export interface EditMessagePayload {
  type: 'edit_message';
  roomId: string;
  messageId: string;
  content: string;
  metadata?: Message['metadata'];
}

export interface DeleteMessagePayload {
  type: 'delete_message';
  roomId: string;
  messageId: string;
}

export interface CreateRoomPayload {
  type: 'create_room';
  name: string;
  isPrivate: boolean;
  memberIds?: string[];
}

export interface RenameRoomPayload {
  type: 'rename_room';
  roomId: string;
  name: string;
}

export interface DeleteRoomPayload {
  type: 'delete_room';
  roomId: string;
}

export interface ResetServerPayload {
  type: 'reset_server';
}

export interface AddRoomMembersPayload {
  type: 'add_room_members';
  roomId: string;
  memberIds: string[];
}

export interface PingPayload {
  type: 'ping';
}

export type ClientPayload =
  | AuthPayload
  | JoinRoomPayload
  | MessagePayload
  | TypingPayload
  | EditMessagePayload
  | DeleteMessagePayload
  | CreateRoomPayload
  | RenameRoomPayload
  | DeleteRoomPayload
  | ResetServerPayload
  | AddRoomMembersPayload
  | PingPayload;

export interface AuthOkPayload {
  type: 'auth_ok';
  userId: string;
  token: string;
  user: User;
  rooms: Room[];
  users: User[];
}

export interface UserJoinedPayload {
  type: 'user_joined';
  user: User;
  roomId: string;
}

export interface UserLeftPayload {
  type: 'user_left';
  userId: string;
  roomId: string;
}

export interface ServerMessagePayload {
  type: 'message';
  message: Message;
}

export interface MessageEditedPayload {
  type: 'message_edited';
  message: Message;
}

export interface MessageDeletedPayload {
  type: 'message_deleted';
  roomId: string;
  messageId: string;
  lastMessage?: Message;
}

export interface HistoryPayload {
  type: 'history';
  roomId: string;
  messages: Message[];
}

export interface RoomCreatedPayload {
  type: 'room_created';
  room: Room;
}

export interface RoomListPayload {
  type: 'room_list';
  rooms: Room[];
}

export interface RoomDeletedPayload {
  type: 'room_deleted';
  roomId: string;
}

export interface ServerResetPayload {
  type: 'server_reset';
  rooms: Room[];
}

export interface ServerTypingPayload {
  type: 'typing';
  userId: string;
  userName: string;
  roomId: string;
  isTyping: boolean;
}

export interface ErrorPayload {
  type: 'error';
  code: string;
  message: string;
}

export interface UserStatusPayload {
  type: 'user_status';
  userId: string;
  status: UserStatus;
}

export type ServerPayload =
  | AuthOkPayload
  | UserJoinedPayload
  | UserLeftPayload
  | ServerMessagePayload
  | MessageEditedPayload
  | MessageDeletedPayload
  | HistoryPayload
  | RoomCreatedPayload
  | RoomListPayload
  | RoomDeletedPayload
  | ServerResetPayload
  | ServerTypingPayload
  | ErrorPayload
  | UserStatusPayload;

export interface DiscoveredServer {
  name: string;
  host: string;
  port: number;
  wsPort: number;
  txt: Record<string, string>;
}

export interface NetworkInfo {
  localIp: string;
  interfaces: NetworkInterface[];
}

export interface NetworkInterface {
  name: string;
  address: string;
  family: 'IPv4' | 'IPv6';
  internal: boolean;
}
