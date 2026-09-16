import type { DatabaseSync } from 'node:sqlite';
import { randomUUID, randomBytes, createHash } from 'node:crypto';

export interface AgentToken {
  id: string;
  userId: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
}

interface AgentTokenRow {
  id: string;
  user_id: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function toAgentToken(row: AgentTokenRow): AgentToken {
  return { id: row.id, userId: row.user_id, label: row.label, createdAt: row.created_at, lastUsedAt: row.last_used_at };
}

export function issueAgentToken(db: DatabaseSync, userId: string, label: string): { token: AgentToken; secret: string } {
  const secret = randomBytes(32).toString('hex');
  const token: AgentToken = { id: randomUUID(), userId, label, createdAt: new Date().toISOString(), lastUsedAt: null };
  db.prepare(
    'INSERT INTO agent_tokens (id, user_id, token_hash, label, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(token.id, token.userId, hashToken(secret), token.label, token.createdAt, null);
  return { token, secret };
}

export function findUserIdByAgentToken(db: DatabaseSync, secret: string): string | undefined {
  const row = db.prepare('SELECT id, user_id FROM agent_tokens WHERE token_hash = ?').get(hashToken(secret)) as
    | { id: string; user_id: string }
    | undefined;
  if (!row) return undefined;
  db.prepare('UPDATE agent_tokens SET last_used_at = ? WHERE id = ?').run(new Date().toISOString(), row.id);
  return row.user_id;
}

export function listAgentTokens(db: DatabaseSync, userId: string): AgentToken[] {
  const rows = db
    .prepare('SELECT id, user_id, label, created_at, last_used_at FROM agent_tokens WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId) as AgentTokenRow[];
  return rows.map(toAgentToken);
}

export function revokeAgentToken(db: DatabaseSync, userId: string, tokenId: string): boolean {
  const result = db.prepare('DELETE FROM agent_tokens WHERE id = ? AND user_id = ?').run(tokenId, userId);
  return result.changes > 0;
}
