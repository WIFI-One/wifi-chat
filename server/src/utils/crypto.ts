import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const SALT_LENGTH = 16;
const TAG_LENGTH = 16;

export function generateToken(): string {
  return randomBytes(32).toString('hex');
}

export function generateSessionId(): string {
  return randomBytes(16).toString('hex');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function deriveKey(password: string, salt: Buffer): Buffer {
  return createHash('sha256').update(password).update(salt).digest();
}

export function encrypt(text: string, password: string): { encrypted: string; iv: string; salt: string; tag: string } {
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const key = deriveKey(password, salt);
  
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  
  return {
    encrypted: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    salt: salt.toString('base64'),
    tag: tag.toString('base64')
  };
}

export function decrypt(encryptedData: { encrypted: string; iv: string; salt: string; tag: string }, password: string): string {
  const key = deriveKey(password, Buffer.from(encryptedData.salt, 'base64'));
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(encryptedData.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(encryptedData.tag, 'base64'));
  
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedData.encrypted, 'base64')),
    decipher.final()
  ]);
  
  return decrypted.toString('utf8');
}

export function sanitizeInput(input: string, maxLength: number = 4000): string {
  return input
    .slice(0, maxLength)
    .replace(/[<>]/g, '')
    .trim();
}

export function validateUsername(username: string): { valid: boolean; error?: string } {
  const trimmed = username.trim();
  
  if (!trimmed) {
    return { valid: false, error: 'Username cannot be empty' };
  }
  
  if (trimmed.length < 2) {
    return { valid: false, error: 'Username must be at least 2 characters' };
  }
  
  if (trimmed.length > 32) {
    return { valid: false, error: 'Username must be at most 32 characters' };
  }
  
  if (!/^[a-zA-Z0-9_\-\.]+$/.test(trimmed)) {
    return { valid: false, error: 'Username can only contain letters, numbers, underscores, hyphens, and dots' };
  }
  
  return { valid: true };
}

export function validateRoomName(name: string): { valid: boolean; error?: string } {
  const trimmed = name.trim();
  
  if (!trimmed) {
    return { valid: false, error: 'Room name cannot be empty' };
  }
  
  if (trimmed.length < 1) {
    return { valid: false, error: 'Room name must be at least 1 character' };
  }
  
  if (trimmed.length > 64) {
    return { valid: false, error: 'Room name must be at most 64 characters' };
  }
  
  return { valid: true };
}