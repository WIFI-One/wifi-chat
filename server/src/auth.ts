import jwt from 'jsonwebtoken';
import { generateToken, hashToken, validateUsername } from './utils/crypto.js';
import { User } from '@wifichat/shared/types';
import { createChildLogger } from './utils/logger.js';

const logger = createChildLogger('auth');

const JWT_SECRET = process.env.JWT_SECRET || 'wifichat-dev-secret-change-in-production';
const TOKEN_EXPIRY = '24h';
const REFRESH_EXPIRY = '7d';

export interface TokenPayload {
  userId: string;
  username: string;
  iat?: number;
  exp?: number;
}

export function generateAuthToken(user: User): string {
  const payload: TokenPayload = {
    userId: user.id,
    username: user.username
  };
  
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as TokenPayload;
  } catch (error) {
    logger.debug('Token verification failed', { error: (error as Error).message });
    return null;
  }
}

export function createSessionToken(): { token: string; hashedToken: string } {
  const token = generateToken();
  const hashedToken = hashToken(token);
  return { token, hashedToken };
}

export function validateAuthPayload(payload: any): { valid: boolean; error?: string; username?: string } {
  if (!payload || typeof payload !== 'object') {
    return { valid: false, error: 'Invalid payload' };
  }
  
  if (payload.type !== 'auth') {
    return { valid: false, error: 'Expected auth payload' };
  }
  
  const usernameValidation = validateUsername(payload.username || '');
  if (!usernameValidation.valid) {
    return { valid: false, error: usernameValidation.error };
  }
  
  return { valid: true, username: payload.username!.trim() };
}

export function createAnonymousUser(username: string, ipAddress?: string, existingId?: string): User {
  return {
    id: existingId || `user_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    username,
    status: 'online',
    ipAddress,
    lastSeen: Date.now(),
    isLocal: true
  };
}