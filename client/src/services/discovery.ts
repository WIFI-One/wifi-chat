import { ServerInfo } from '@wifichat/shared/types';
import { useDiscoveryStore } from '../context/stores';
import { settingsStorage } from './storage';

const DEFAULT_PORT = 3000;
const PROBE_TIMEOUT_MS = 1500;
const SCAN_CONCURRENCY = 24;

/**
 * Browser-compatible LAN discovery.
 *
 * Browsers cannot use mDNS/Bonjour or UDP directly, so discovery works by:
 *  1. Probing the page's own origin (covers "served by the host" case).
 *  2. Probing the last-known server URL from local storage.
 *  3. Detecting the device's own LAN IP via WebRTC and sweeping the /24
 *     subnet for `GET http://<ip>:3000/info` (WifiChat servers answer it).
 * Manual entry remains as a fallback.
 */
class DiscoveryService {
  private scanning = false;
  private scanId = 0;
  private foundServers: Map<string, ServerInfo> = new Map();

  get isScanning(): boolean {
    return this.scanning;
  }

  async startScanning(): Promise<ServerInfo[]> {
    if (this.scanning) return this.getServers();
    this.scanning = true;
    const myScan = ++this.scanId;
    useDiscoveryStore.getState().setScanning(true);
    useDiscoveryStore.getState().setError(null);

    try {
      const candidates = await this.buildCandidates();
      await this.probeAll(candidates, myScan);
    } catch (error) {
      if (myScan === this.scanId) {
        useDiscoveryStore.getState().setError((error as Error).message);
      }
    } finally {
      if (myScan === this.scanId) {
        this.scanning = false;
        useDiscoveryStore.getState().setScanning(false);
      }
    }
    return this.getServers();
  }

  stopScanning(): void {
    this.scanId++;
    this.scanning = false;
    useDiscoveryStore.getState().setScanning(false);
  }

  getServers(): ServerInfo[] {
    return Array.from(this.foundServers.values()).sort((a, b) => b.lastSeen - a.lastSeen);
  }

  clearServers(): void {
    this.foundServers.clear();
    useDiscoveryStore.getState().setServers([]);
  }

  /** Probe one explicit base URL (manual entry) and register it if valid. */
  async probeUrl(baseUrl: string): Promise<ServerInfo | null> {
    const normalized = normalizeBaseUrl(baseUrl);
    if (!normalized) return null;
    const info = await probeInfo(normalized, PROBE_TIMEOUT_MS);
    if (info) this.register(info);
    return info;
  }

  connectUrl(server: ServerInfo): string {
    return `http://${server.host}:${server.port}`;
  }

  private async buildCandidates(): Promise<string[]> {
    const set = new Set<string>();
    const prefixes: string[] = [];
    const addSubnet = (prefix: string) => {
      if (!prefixes.includes(prefix)) prefixes.push(prefix);
    };

    // 0. Sweep the page's own subnet first — no WebRTC needed. On a phone
    //    this is exactly the Wi-Fi subnet the server lives on.
    if (typeof window !== 'undefined' && isPrivateIPv4(window.location.hostname)) {
      addSubnet(window.location.hostname.split('.').slice(0, 3).join('.'));
    }

    // 1. Same origin that served this page (covers "served by the host" case).
    if (typeof window !== 'undefined') {
      const origin = window.location.origin;
      if (origin.startsWith('http')) set.add(origin);
      set.add(`http://${window.location.hostname}:${DEFAULT_PORT}`);
    }

    // 2. Last-known server.
    const last = settingsStorage.getLastServer();
    if (last) {
      const normalized = normalizeBaseUrl(last);
      if (normalized) set.add(normalized);
    }
    set.add(`http://localhost:${DEFAULT_PORT}`);
    set.add(`http://127.0.0.1:${DEFAULT_PORT}`);

    // 3. Subnets from WebRTC-detected local IPs (best effort — browsers
    //    increasingly obfuscate these, so this often yields nothing).
    const localIps = await detectLocalIps();
    for (const ip of localIps) {
      addSubnet(ip.split('.').slice(0, 3).join('.'));
    }

    // 4. Last resort on localhost pages with no detected subnet: the most
    //    common home subnets. (Exotic subnets: use manual entry.)
    if (prefixes.length === 0 && typeof window !== 'undefined') {
      const h = window.location.hostname;
      if (h === 'localhost' || h === '127.0.0.1') {
        addSubnet('192.168.1');
        addSubnet('192.168.0');
      }
    }

    for (const prefix of prefixes) {
      for (let i = 1; i < 255; i++) {
        const host = `${prefix}.${i}`;
        if (localIps.includes(host)) continue;
        set.add(`http://${host}:${DEFAULT_PORT}`);
      }
    }

    return Array.from(set);
  }

  private async probeAll(candidates: string[], myScan: number): Promise<void> {
    let index = 0;
    const workers = Array.from(
      { length: Math.min(SCAN_CONCURRENCY, candidates.length) },
      async () => {
        while (index < candidates.length && myScan === this.scanId) {
          const url = candidates[index++];
          try {
            const info = await probeInfo(url, PROBE_TIMEOUT_MS);
            if (info && myScan === this.scanId) this.register(info);
          } catch {
            // Host not running WifiChat — ignore.
          }
        }
      }
    );
    await Promise.all(workers);
  }

  private register(info: ServerInfo): void {
    // Key by server id: one host can answer on several LAN IPs, and we only
    // want a single entry per server (the most recently responding address).
    const key = info.id || `${info.host}:${info.port}`;
    this.foundServers.set(key, info);
    useDiscoveryStore.getState().addServer(info);
  }
}

export function normalizeBaseUrl(input: string): string | null {
  const trimmed = input.trim().replace(/\/+$/, '');
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `http://${trimmed}`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.pathname = '/';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

async function probeInfo(baseUrl: string, timeoutMs: number): Promise<ServerInfo | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/info`, { signal: controller.signal });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || typeof data !== 'object') return null;
    const url = new URL(baseUrl);
    return {
      id: String(data.id || `${url.hostname}:${data.port || DEFAULT_PORT}`),
      name: String(data.name || 'WifiChat Server'),
      host: url.hostname,
      port: Number(data.port || url.port || DEFAULT_PORT),
      wsPort: Number(data.wsPort || data.port || DEFAULT_PORT),
      userCount: Number(data.userCount ?? data.users ?? 0),
      version: String(data.version || '1.0.0'),
      lastSeen: Date.now()
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * NOTE: `host` is taken from the URL that actually answered — not from the
 * server's self-reported `data.host`. A host can have several LAN interfaces
 * (VPN, Docker, Wi-Fi) and its "primary" IP is often unreachable from this
 * device, while the address we just got a response from works by definition.
 */

/** Best-effort LAN IP detection via WebRTC ICE candidates. */
function detectLocalIps(): Promise<string[]> {
  return new Promise((resolve) => {
    const ips = new Set<string>();
    try {
      const RTC = window.RTCPeerConnection;
      if (!RTC) {
        resolve([]);
        return;
      }
      const pc = new RTC({ iceServers: [] });
      pc.createDataChannel('wifichat-discovery');
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          const match = /([0-9]{1,3}(?:\.[0-9]{1,3}){3})/.exec(event.candidate.candidate);
          if (match && !match[1].startsWith('0.')) ips.add(match[1]);
        } else {
          pc.close();
          resolve(filterPrivateIps(ips));
        }
      };
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .catch(() => resolve([]));
      setTimeout(() => {
        try {
          pc.close();
        } catch {
          // ignore
        }
        resolve(filterPrivateIps(ips));
      }, 4000);
    } catch {
      resolve([]);
    }
  });
}

export function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}
function isPrivateIPv4(ip: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if ([a, ...m.slice(2).map(Number)].some((n) => n > 255)) return false;
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function filterPrivateIps(ips: Set<string>): string[] {
  return Array.from(ips).filter(isPrivateIPv4);
}

export const discoveryService = new DiscoveryService();
