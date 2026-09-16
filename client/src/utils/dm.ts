import type { Room, User } from '@wifichat/shared/types';
import { storage } from '../services/storage';

const PEER_CACHE_KEY = 'dmPeerNames';

/** The other participant's id for a DM room, or null for group rooms. */
export function getDmPeerId(room: Room, myId?: string | null): string | null {
  if (!room.id.startsWith('dm_')) return null;
  return room.members.find((id) => id !== myId) ?? null;
}

/**
 * Display name for a DM room: the peer's username. Falls back to a cached
 * name from when they were last seen online, so offline peers still show
 * correctly instead of the generic room name.
 */
export function resolveDmPeerName(
  room: Room,
  users: User[],
  myId?: string | null
): string | null {
  const peerId = getDmPeerId(room, myId);
  if (!peerId) return null;
  const online = users.find((u) => u.id === peerId);
  if (online) return online.username;
  const cache = storage.get<Record<string, string>>(PEER_CACHE_KEY, {});
  return cache[peerId] ?? null;
}

/** Remember a username so DM rooms keep their peer name while offline. */
export function rememberDmPeer(user: Pick<User, 'id' | 'username'>): void {
  const cache = storage.get<Record<string, string>>(PEER_CACHE_KEY, {});
  if (cache[user.id] !== user.username) {
    storage.set(PEER_CACHE_KEY, { ...cache, [user.id]: user.username });
  }
}
