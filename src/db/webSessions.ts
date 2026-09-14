import type { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';

const WEB_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export function createWebSession(db: DatabaseSync, userId: string): { id: string; expiresAt: string } {
  const id = randomBytes(32).toString('hex');
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + WEB_SESSION_TTL_MS);
  db.prepare('INSERT INTO web_sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    id,
    userId,
    createdAt.toISOString(),
    expiresAt.toISOString(),
  );
  return { id, expiresAt: expiresAt.toISOString() };
}

export function findUserIdByWebSession(db: DatabaseSync, id: string): string | undefined {
  const row = db.prepare('SELECT user_id, expires_at FROM web_sessions WHERE id = ?').get(id) as
    | { user_id: string; expires_at: string }
    | undefined;
  if (!row) return undefined;
  if (new Date(row.expires_at).getTime() <= Date.now()) return undefined;
  return row.user_id;
}

export function deleteWebSession(db: DatabaseSync, id: string): void {
  db.prepare('DELETE FROM web_sessions WHERE id = ?').run(id);
}
