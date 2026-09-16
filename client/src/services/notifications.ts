import { settingsStorage } from './storage';

export interface ChatNotification {
  senderName: string;
  roomName: string;
  isDM: boolean;
  preview: string;
  roomId: string;
  /** True when the tab is hidden or the user is looking at another room. */
  background: boolean;
  onOpen: (roomId: string) => void;
}

let unreadCount = 0;
let baseTitle: string | null = null;

function ensureBaseTitle(): string {
  if (baseTitle === null) {
    baseTitle = typeof document !== 'undefined' ? document.title || 'WifiChat' : 'WifiChat';
  }
  return baseTitle;
}

function renderTitle(): void {
  if (typeof document === 'undefined') return;
  document.title = unreadCount > 0 ? `(${unreadCount}) ${ensureBaseTitle()}` : ensureBaseTitle();
}

/** Clear the unread badge (call when the user looks at the chat). */
export function resetUnreadBadge(): void {
  unreadCount = 0;
  renderTitle();
}

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  if (!notificationsSupported()) return 'unsupported';
  return Notification.permission;
}

/** Ask the browser for notification permission (call after a user gesture). */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!notificationsSupported()) return false;
  try {
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    return (await Notification.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

function playBeep(): void {
  try {
    if (!settingsStorage.getSound()) return;
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
    osc.onended = () => void ctx.close().catch(() => {});
  } catch {
    // sound is best-effort
  }
}

/**
 * Notify about an incoming message from someone else. Shows a system
 * notification + title badge + sound only when the message arrives in the
 * background (tab hidden or another room open). Messages in the room the
 * user is actively viewing stay silent.
 */
export function notifyChatMessage(n: ChatNotification): void {
  if (!n.background) return;
  unreadCount += 1;
  renderTitle();
  playBeep();
  if (!settingsStorage.getNotifications()) return;
  if (!notificationsSupported() || Notification.permission !== 'granted') return;
  try {
    const title = n.isDM ? n.senderName : `${n.senderName} in ${n.roomName}`;
    const notification = new Notification(title, {
      body: n.preview,
      tag: `wifichat-${n.roomId}`
    });
    notification.onclick = () => {
      try {
        window.focus();
      } catch {
        // ignore
      }
      n.onOpen(n.roomId);
      notification.close();
    };
  } catch {
    // notifications are best-effort
  }
}
