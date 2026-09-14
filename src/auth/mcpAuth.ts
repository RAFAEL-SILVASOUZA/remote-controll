import type { Request, Response, NextFunction } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { findUserIdByAccessToken } from '../db/oauthTokens.js';

function extractBearerToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return undefined;
  return header.slice('Bearer '.length).trim();
}

export function requireMcpAuth(db: DatabaseSync, publicBaseUrl: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const token = extractBearerToken(req);
    const userId = token ? findUserIdByAccessToken(db, token) : undefined;
    if (!userId) {
      res.setHeader(
        'WWW-Authenticate',
        `Bearer resource_metadata="${publicBaseUrl}/.well-known/oauth-protected-resource"`,
      );
      res.status(401).json({ error: 'invalid_token' });
      return;
    }
    req.userId = userId;
    req.workspace = typeof req.headers['x-workspace'] === 'string' ? req.headers['x-workspace'] : 'Desconhecido';
    next();
  };
}
