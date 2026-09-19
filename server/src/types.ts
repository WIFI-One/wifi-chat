import { User, Message, Room, MessageType, UserStatus } from '@wifichat/shared/types';

export interface ConnectedClient {
  id: string;
  ws: any;
  user: User;
  rooms: Set<string>;
  lastPing: number;
  messageCount: number;
  lastMessageTime: number;
}

export interface ServerConfig {
  httpPort: number;
  wsPort: number;
  host: string;
  maxMessageLength: number;
  maxMessageRate: number;
  rateLimitWindow: number;
  pingInterval: number;
  pingTimeout: number;
  maxFileSizeMB: number;
}

export const DEFAULT_CONFIG: ServerConfig = {
  httpPort: 3000,
  wsPort: 3001,
  host: '0.0.0.0',
  maxMessageLength: 4000,
  maxMessageRate: 30,
  rateLimitWindow: 60000,
  pingInterval: 25000,
  pingTimeout: 10000,
  maxFileSizeMB: 1024
};

export type { User, Message, Room, MessageType, UserStatus };