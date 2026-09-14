import type { Request, Response, NextFunction } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { findUserIdByToken } from '../db/tokens.js';

function extractBearerToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return undefined;
  return header.slice('Bearer '.length).trim();
}

export function requireMcpAuth(db: DatabaseSync) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const token = extractBearerToken(req);
    const userId = token ? findUserIdByToken(db, token) : undefined;
    if (!userId) {
      res.status(401).json({ error: 'authentication_required', pairingStartUrl: '/api/mcp/pairing/start' });
      return;
    }
    req.userId = userId;
    req.workspace = typeof req.headers['x-workspace'] === 'string' ? req.headers['x-workspace'] : 'Desconhecido';
    next();
  };
}
