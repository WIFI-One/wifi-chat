import { networkInterfaces } from 'os';
import { NetworkInterface } from '@wifichat/shared/types';

export function getLocalIpAddresses(): string[] {
  const interfaces = networkInterfaces();
  const ips: string[] = [];
  
  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        ips.push(addr.address);
      }
    }
  }

  // List the primary (Wi-Fi) address first.
  const primary = getPrimaryLocalIp();
  if (primary) {
    ips.sort((a, b) => (a === primary ? -1 : b === primary ? 1 : 0));
  }
  
  return ips;
}

export function getNetworkInterfaces(): NetworkInterface[] {
  const interfaces = networkInterfaces();
  const result: NetworkInterface[] = [];
  
  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    
    for (const addr of addrs) {
      result.push({
        name,
        address: addr.address,
        family: addr.family === 'IPv4' ? 'IPv4' : 'IPv6',
        internal: addr.internal
      });
    }
  }
  
  return result;
}

export function getPrimaryLocalIp(): string | null {
  const interfaces = networkInterfaces();
  let best: { ip: string; score: number } | null = null;
  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      const score = ifaceScore(name, addr.address);
      if (!best || score > best.score) best = { ip: addr.address, score };
    }
  }
  return best?.ip ?? null;
}

/**
 * Rank addresses so the advertised IP is the real LAN/Wi-Fi one.
 * VPN tunnels, Docker bridges and other virtual interfaces are
 * deprioritized: phones on Wi-Fi usually can't route to them.
 * Preference: 192.168/16 (typical home Wi-Fi) > 172.16/12 > 10/8 > rest.
 */
function ifaceScore(name: string, ip: string): number {
  if (VIRTUAL_IFACE_PATTERNS.some((re) => re.test(name))) return -1;
  if (ip.startsWith('192.168.')) return 100;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 80;
  if (ip.startsWith('10.')) return 60;
  return 10;
}

const VIRTUAL_IFACE_PATTERNS: RegExp[] = [
  /vpn/i,
  /^tun/i,
  /tap/i,
  /docker/i,
  /veth/i,
  /^br-/i,
  /tailscale/i,
  /(^|[^a-z])zt\d*/i,
  /wireguard/i,
  /^wg\d*$/i,
  /^ppp/i,
  /vmnet/i,
  /virtualbox/i,
  /host-only/i,
  /hyper-v/i,
  /vswitch/i,
  /isatap/i,
  /teredo/i,
];

export function isLocalIp(ip: string): boolean {
  return (
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    ip.startsWith('172.') && parseInt(ip.split('.')[1]) >= 16 && parseInt(ip.split('.')[1]) <= 31 ||
    ip === '127.0.0.1' ||
    ip === '::1'
  );
}

export function getBroadcastAddress(ip: string, subnetMask: string = '255.255.255.0'): string {
  const ipParts = ip.split('.').map(Number);
  const maskParts = subnetMask.split('.').map(Number);
  const broadcastParts = ipParts.map((part, i) => part | (~maskParts[i] & 0xff));
  return broadcastParts.join('.');
}