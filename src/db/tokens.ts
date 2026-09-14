import type { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash } from 'node:crypto';

const TOKEN_TTL_MS = 5 * 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createToken(db: DatabaseSync, userId: string): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString('hex');
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + TOKEN_TTL_MS);
  db.prepare('INSERT INTO mcp_tokens (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    hashToken(token),
    userId,
    createdAt.toISOString(),
    expiresAt.toISOString(),
  );
  return { token, expiresAt: expiresAt.toISOString() };
}

export function findUserIdByToken(db: DatabaseSync, token: string): string | undefined {
  const row = db.prepare('SELECT user_id, expires_at FROM mcp_tokens WHERE token_hash = ?').get(hashToken(token)) as
    | { user_id: string; expires_at: string }
    | undefined;
  if (!row) return undefined;
  if (new Date(row.expires_at).getTime() <= Date.now()) return undefined;
  return row.user_id;
}
