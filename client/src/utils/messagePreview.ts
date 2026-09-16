import type { Message } from '@wifichat/shared/types';

/**
 * One-line sidebar/notification preview for a message.
 * Media messages show a generic "Sent an image / a video / a file"
 * label — no emoji, no file name.
 */
export function messagePreview(message: Message): string {
  const kind = mediaKindLabel(message);
  if (kind) return `Sent ${kind}`;
  return message.content;
}

/**
 * Plain-words kind of an attachment for sidebar previews:
 * "an image", "a video" or "a file". Null for text messages.
 */
export function mediaKindLabel(message: Message): 'an image' | 'a video' | 'a file' | null {
  const mime = message.metadata?.mimeType ?? '';
  if (mime.startsWith('video/') || message.content.startsWith('data:video/')) {
    return 'a video';
  }
  if (message.type === 'image' || message.content.startsWith('data:image/')) {
    return 'an image';
  }
  if (message.type === 'file' || message.content.startsWith('data:')) {
    return 'a file';
  }
  return null;
}
