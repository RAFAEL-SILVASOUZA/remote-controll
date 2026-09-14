import type { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash } from 'node:crypto';

const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 5 * 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface IssuedTokens {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

export function issueTokens(db: DatabaseSync, clientId: string, userId: string): IssuedTokens {
  const accessToken = randomBytes(32).toString('hex');
  const refreshToken = randomBytes(32).toString('hex');
  const now = new Date();
  const accessExpiresAt = new Date(now.getTime() + ACCESS_TOKEN_TTL_MS);
  const refreshExpiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_MS);

  db.prepare(
    'INSERT INTO oauth_access_tokens (token_hash, client_id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
  ).run(hashToken(accessToken), clientId, userId, now.toISOString(), accessExpiresAt.toISOString());

  db.prepare(
    'INSERT INTO oauth_refresh_tokens (token_hash, client_id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
  ).run(hashToken(refreshToken), clientId, userId, now.toISOString(), refreshExpiresAt.toISOString());

  return {
    accessToken,
    accessTokenExpiresAt: accessExpiresAt.toISOString(),
    refreshToken,
    refreshTokenExpiresAt: refreshExpiresAt.toISOString(),
  };
}

export function findUserIdByAccessToken(db: DatabaseSync, token: string): string | undefined {
  const row = db.prepare('SELECT user_id, expires_at FROM oauth_access_tokens WHERE token_hash = ?').get(
    hashToken(token),
  ) as { user_id: string; expires_at: string } | undefined;
  if (!row) return undefined;
  if (new Date(row.expires_at).getTime() <= Date.now()) return undefined;
  return row.user_id;
}

/**
 * Rotates a refresh token: the old one is deleted and a brand new
 * access/refresh pair is issued. Throws a plain Error (mapped to OAuth's
 * `invalid_grant` by the route) for unknown/mismatched/expired tokens.
 */
export function rotateRefreshToken(db: DatabaseSync, refreshToken: string, clientId: string): IssuedTokens {
  const hash = hashToken(refreshToken);
  const row = db.prepare('SELECT client_id, user_id, expires_at FROM oauth_refresh_tokens WHERE token_hash = ?').get(
    hash,
  ) as { client_id: string; user_id: string; expires_at: string } | undefined;
  if (!row) throw new Error('Refresh token inválido.');
  if (row.client_id !== clientId) throw new Error('Refresh token não pertence a este client.');
  if (new Date(row.expires_at).getTime() <= Date.now()) throw new Error('Refresh token expirado.');
  db.prepare('DELETE FROM oauth_refresh_tokens WHERE token_hash = ?').run(hash);
  return issueTokens(db, row.client_id, row.user_id);
}
