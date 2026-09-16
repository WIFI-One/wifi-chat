import { ConnectedClient, DEFAULT_CONFIG } from './types.js';
import { User, UserStatus } from '@wifichat/shared/types';
import { createChildLogger } from './utils/logger.js';

const logger = createChildLogger('clients');

export class ClientManager {
  private clients: Map<string, ConnectedClient> = new Map();
  private userIdToClientId: Map<string, string> = new Map();
  private config = DEFAULT_CONFIG;

  addClient(clientId: string, ws: any, user: User): ConnectedClient {
    const client: ConnectedClient = {
      id: clientId,
      ws,
      user,
      rooms: new Set(),
      lastPing: Date.now(),
      messageCount: 0,
      lastMessageTime: 0
    };
    
    this.clients.set(clientId, client);
    this.userIdToClientId.set(user.id, clientId);
    
    logger.debug('Client added', { clientId, userId: user.id, username: user.username });
    return client;
  }

  removeClient(clientId: string): ConnectedClient | null {
    const client = this.clients.get(clientId);
    if (client) {
      this.clients.delete(clientId);
      this.userIdToClientId.delete(client.user.id);
      logger.debug('Client removed', { clientId, userId: client.user.id });
    }
    return client || null;
  }

  getClient(clientId: string): ConnectedClient | undefined {
    return this.clients.get(clientId);
  }

  getClientByUserId(userId: string): ConnectedClient | undefined {
    const clientId = this.userIdToClientId.get(userId);
    return clientId ? this.clients.get(clientId) : undefined;
  }

  getClientsInRoom(roomId: string): ConnectedClient[] {
    const clients: ConnectedClient[] = [];
    for (const client of this.clients.values()) {
      if (client.rooms.has(roomId)) {
        clients.push(client);
      }
    }
    return clients;
  }

  getAllClients(): ConnectedClient[] {
    return Array.from(this.clients.values());
  }

  getOnlineUsers(): User[] {
    return Array.from(this.clients.values()).map(c => ({
      ...c.user,
      status: 'online' as UserStatus,
      lastSeen: Date.now()
    }));
  }

  addClientToRoom(clientId: string, roomId: string): boolean {
    const client = this.clients.get(clientId);
    if (client) {
      client.rooms.add(roomId);
      return true;
    }
    return false;
  }

  removeClientFromRoom(clientId: string, roomId: string): boolean {
    const client = this.clients.get(clientId);
    if (client) {
      return client.rooms.delete(roomId);
    }
    return false;
  }

  updateClientActivity(clientId: string): boolean {
    const client = this.clients.get(clientId);
    if (client) {
      client.lastPing = Date.now();
      return true;
    }
    return false;
  }

  recordMessage(clientId: string): { allowed: boolean; remaining: number } {
    const client = this.clients.get(clientId);
    if (!client) return { allowed: false, remaining: 0 };
    
    const now = Date.now();
    if (now - client.lastMessageTime > this.config.rateLimitWindow) {
      client.messageCount = 0;
      client.lastMessageTime = now;
    }
    
    client.messageCount++;
    const remaining = Math.max(0, this.config.maxMessageRate - client.messageCount);
    
    return { allowed: client.messageCount <= this.config.maxMessageRate, remaining };
  }

  getClientCount(): number {
    return this.clients.size;
  }
}

export const clientManager = new ClientManager();