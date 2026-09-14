import type { Request, Response, NextFunction } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { findUserIdByWebSession } from '../db/webSessions.js';

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      workspace?: string;
    }
  }
}

const COOKIE_NAME = 'session';

function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

export function getSessionCookie(req: Request): string | undefined {
  return parseCookies(req.headers.cookie)[COOKIE_NAME];
}

export function setSessionCookie(res: Response, sessionId: string): void {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${sessionId}; HttpOnly; Secure; SameSite=Lax; Path=/`);
}

export function clearSessionCookie(res: Response): void {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
}

export function attachUser(db: DatabaseSync) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const sessionId = getSessionCookie(req);
    if (sessionId) {
      req.userId = findUserIdByWebSession(db, sessionId);
    }
    next();
  };
}

export function requireWebAuthPage(req: Request, res: Response, next: NextFunction): void {
  if (!req.userId) {
    res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    return;
  }
  next();
}

export function requireWebAuthApi(req: Request, res: Response, next: NextFunction): void {
  if (!req.userId) {
    res.status(401).json({ error: 'authentication_required' });
    return;
  }
  next();
}
