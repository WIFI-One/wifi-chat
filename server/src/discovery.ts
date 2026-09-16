import { Bonjour } from 'bonjour-service';
import mdns from 'multicast-dns';
import { getLocalIpAddresses, getPrimaryLocalIp } from './utils/network.js';
import { ServerInfo, DiscoveredServer } from '@wifichat/shared/types';
import { createChildLogger } from './utils/logger.js';

const logger = createChildLogger('discovery');

const SERVICE_TYPE = 'wifichat';
const SERVICE_PROTOCOL = 'tcp';
const SERVICE_NAME = 'WifiChat';

/** Friendly LAN hostname — any device on the Wi-Fi can open http://wifichat.local:3000 */
export const LAN_HOSTNAME = 'wifichat.local';

interface BonjourBrowser {
  stop: () => void;
  on: (event: string, listener: (...args: any[]) => void) => this;
}

export class DiscoveryService {
  private bonjour: Bonjour | null = null;
  private published = false;
  private serverInfo: ServerInfo | null = null;
  private discoveredServers: Map<string, DiscoveredServer> = new Map();
  private onServerFound: ((server: DiscoveredServer) => void) | null = null;
  private onServerLost: ((server: DiscoveredServer) => void) | null = null;
  private browser: BonjourBrowser | null = null;

  constructor() {
    this.bonjour = new Bonjour();
  }

  async startAdvertising(httpPort: number, wsPort: number, userCount: number): Promise<void> {
    if (!this.bonjour) {
      throw new Error('Bonjour not initialized');
    }

    const localIp = getPrimaryLocalIp();
    if (!localIp) {
      throw new Error('No local IP address found');
    }

    this.serverInfo = {
      id: `server_${Date.now()}`,
      name: SERVICE_NAME,
      host: localIp,
      port: httpPort,
      wsPort,
      userCount,
      version: '1.0.0',
      lastSeen: Date.now()
    };

    return new Promise<void>((resolve, reject) => {
      const service = this.bonjour!.publish({
        name: this.serverInfo!.name,
        type: SERVICE_TYPE,
        protocol: SERVICE_PROTOCOL,
        port: httpPort,
        host: localIp,
        txt: {
          wsPort: wsPort.toString(),
          userCount: userCount.toString(),
          version: this.serverInfo!.version,
          id: this.serverInfo!.id
        }
      });

      service.on('error', (err: Error) => {
        logger.error('Failed to publish mDNS service', { error: err.message });
        reject(err);
      });

      service.on('up', () => {
        this.published = true;
        logger.info('mDNS service published', { 
          name: this.serverInfo!.name, 
          host: localIp, 
          port: httpPort,
          wsPort 
        });
        resolve();
      });
    });
  }

  async stopAdvertising(): Promise<void> {
    if (this.published && this.bonjour) {
      return new Promise((resolve) => {
        this.bonjour!.unpublishAll(() => {
          this.published = false;
          logger.info('mDNS service unpublished');
          resolve();
        });
      });
    }
  }

  async startBrowsing(): Promise<void> {
    if (!this.bonjour) {
      throw new Error('Bonjour not initialized');
    }

    return new Promise((resolve) => {
      const browser = this.bonjour!.find({ type: SERVICE_TYPE, protocol: SERVICE_PROTOCOL }, (service) => {
        const server: DiscoveredServer = {
          name: service.name,
          host: service.host,
          port: service.port,
          wsPort: parseInt(service.txt?.wsPort || '3001', 10),
          txt: service.txt as Record<string, string>
        };

        const key = `${server.host}:${server.port}`;
        
        if (!this.discoveredServers.has(key)) {
          this.discoveredServers.set(key, server);
          logger.info('Server discovered', { name: server.name, host: server.host, port: server.port });
          
          if (this.onServerFound) {
            this.onServerFound(server);
          }
        } else {
          this.discoveredServers.set(key, server);
        }
      });

      this.browser = browser as unknown as BonjourBrowser;

      this.browser!.on('down', (service: any) => {
        const key = `${service.host}:${service.port}`;
        const server = this.discoveredServers.get(key);
        
        if (server && this.onServerLost) {
          this.onServerLost(server);
        }
        
        this.discoveredServers.delete(key);
        logger.info('Server lost', { host: service.host, port: service.port });
      });

      logger.info('Started browsing for WifiChat servers');
      resolve();
    });
  }

  stopBrowsing(): void {
    if (this.browser) {
      this.browser.stop();
      this.browser = null;
      logger.info('Stopped browsing for servers');
    }
  }

  getDiscoveredServers(): DiscoveredServer[] {
    return Array.from(this.discoveredServers.values());
  }

  setServerFoundCallback(callback: (server: DiscoveredServer) => void): void {
    this.onServerFound = callback;
  }

  setServerLostCallback(callback: (server: DiscoveredServer) => void): void {
    this.onServerLost = callback;
  }

  updateUserCount(count: number): void {
    if (this.serverInfo) {
      this.serverInfo.userCount = count;
      if (this.published && this.bonjour) {
        this.bonjour.unpublishAll(() => {
          this.startAdvertising(this.serverInfo!.port, this.serverInfo!.wsPort, count);
        });
      }
    }
  }

  getServerInfo(): ServerInfo | null {
    return this.serverInfo;
  }

  destroy(): void {
    this.stopAdvertising();
    this.stopBrowsing();
    if (this.bonjour) {
      this.bonjour.destroy();
      this.bonjour = null;
    }
  }
}

export const discoveryService = new DiscoveryService();

/**
 * Answer mDNS queries for `wifichat.local` with the host's LAN IP so any
 * device on the same Wi-Fi can open http://wifichat.local:<port> without
 * knowing numeric addresses. Best-effort: failures only produce a warning.
 */
export function startHostnameResponder(ip: string): void {
  try {
    const socket = mdns();
    socket.on('error', (err: Error) => {
      logger.warn('mDNS hostname responder error', { error: err.message });
    });
    socket.on('query', (query) => {
      const questions = query?.questions || [];
      const asked = questions.some((q) => q && q.name === LAN_HOSTNAME && q.type === 'A');
      if (asked) {
        socket.respond({
          answers: [{ name: LAN_HOSTNAME, type: 'A', ttl: 120, data: ip }]
        });
      }
    });
    logger.info('Answering mDNS queries for wifichat.local', { ip });
  } catch (error) {
    logger.warn('Could not start wifichat.local responder', {
      error: (error as Error).message
    });
  }
}