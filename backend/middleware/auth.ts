import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import { db } from '../database/db.ts';

function resolveJwtSecret(): string {
  const configured = process.env.JWT_SECRET?.trim();
  if (configured && configured.length >= 32) {
    return configured;
  }
  if (configured && configured.length > 0) {
    console.warn('[security] JWT_SECRET should be at least 32 characters long.');
    return configured;
  }
  if (process.env.NODE_ENV === 'production') {
    console.warn('[security] JWT_SECRET is not set in production; generating an ephemeral per-boot signing key.');
  }
  return crypto.randomBytes(32).toString('hex');
}

const JWT_SECRET = resolveJwtSecret();
const TOKEN_EXPIRY = '24h';
export const SESSION_COOKIE_NAME = 'vr_session';

export interface AuthPayload {
  userId: number;
  areaId: number;
  role: 'ADMIN' | 'EMPLOYEE';
  email: string;
}

export interface AuthedRequest extends Request {
  auth?: AuthPayload;
}

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, 10);
}

export function verifyPassword(plain: string, hash: string): boolean {
  return bcrypt.compareSync(plain, hash);
}

export function generateDeviceKey(sensorId: number): { rawKey: string; keyHash: string } {
  const secretPart = crypto.randomBytes(20).toString('hex');
  const rawKey = `vr_${sensorId}_${secretPart}`;
  const keyHash = bcrypt.hashSync(rawKey, 10);
  return { rawKey, keyHash };
}

export function verifyDeviceKey(rawKey: string, keyHash: string): boolean {
  return bcrypt.compareSync(rawKey, keyHash);
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

export function verifyToken(token: string): AuthPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as AuthPayload;
  } catch {
    return null;
  }
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};
  const result: Record<string, string> = {};
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx > -1) {
      const k = part.slice(0, idx).trim();
      const v = decodeURIComponent(part.slice(idx + 1).trim());
      result[k] = v;
    }
  }
  return result;
}

export function setSessionCookie(req: Request, res: Response, token: string): void {
  const isHttps =
    req.secure ||
    req.headers['x-forwarded-proto'] === 'https' ||
    (process.env.APP_URL || '').startsWith('https://');
  const maxAgeSeconds = 60 * 60 * 24;
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (isHttps) {
    parts.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(req: Request, res: Response): void {
  const isHttps =
    req.secure ||
    req.headers['x-forwarded-proto'] === 'https' ||
    (process.env.APP_URL || '').startsWith('https://');
  const parts = [`${SESSION_COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'Max-Age=0'];
  if (isHttps) {
    parts.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function extractTokenFromRequest(req: Request): { token: string | null; viaCookie: boolean } {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return { token: authHeader.slice(7).trim(), viaCookie: false };
  }
  const cookies = parseCookies(req.headers.cookie);
  if (cookies[SESSION_COOKIE_NAME]) {
    return { token: cookies[SESSION_COOKIE_NAME], viaCookie: true };
  }
  return { token: null, viaCookie: false };
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const { token, viaCookie } = extractTokenFromRequest(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  if (viaCookie && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const origin = req.headers.origin;
    const host = (req.headers['x-forwarded-host'] as string) || req.headers.host;
    if (origin && host) {
      try {
        const originHost = new URL(origin).host;
        if (originHost !== host) {
          res.status(403).json({ error: 'Invalid request origin' });
          return;
        }
      } catch {
        res.status(403).json({ error: 'Invalid origin header' });
        return;
      }
    }
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    res.status(401).json({ error: 'Session expired or invalid token' });
    return;
  }

  const user = db
    .prepare('SELECT id, area_id, role, status, email FROM users WHERE id = ?')
    .get(decoded.userId) as
    | { id: number; area_id: number; role: 'ADMIN' | 'EMPLOYEE'; status: string; email: string }
    | undefined;

  if (!user) {
    res.status(401).json({ error: 'Account no longer exists' });
    return;
  }
  if (user.status !== 'ACTIVE') {
    res.status(403).json({ error: 'Your account is deactivated. Contact your area admin.' });
    return;
  }

  req.auth = {
    userId: user.id,
    areaId: user.area_id,
    role: user.role,
    email: user.email,
  };
  next();
}

export function requireRole(role: 'ADMIN' | 'EMPLOYEE') {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    if (req.auth.role !== role) {
      res.status(403).json({ error: `Access restricted to ${role} accounts` });
      return;
    }
    next();
  };
}

export function validatePasswordStrength(password: string): string | null {
  if (!password || password.length < 8) {
    return 'Password must be at least 8 characters long';
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Password must contain at least one letter and one number';
  }
  return null;
}
