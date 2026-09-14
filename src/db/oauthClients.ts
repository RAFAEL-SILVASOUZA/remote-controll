import type { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';

export interface OAuthClient {
  clientId: string;
  redirectUris: string[];
  clientName?: string;
  createdAt: string;
}

interface ClientRow {
  client_id: string;
  redirect_uris: string;
  client_name: string | null;
  created_at: string;
}

function toClient(row: ClientRow): OAuthClient {
  return {
    clientId: row.client_id,
    redirectUris: JSON.parse(row.redirect_uris) as string[],
    clientName: row.client_name ?? undefined,
    createdAt: row.created_at,
  };
}

export function registerClient(db: DatabaseSync, redirectUris: string[], clientName?: string): OAuthClient {
  const clientId = randomBytes(16).toString('hex');
  const createdAt = new Date().toISOString();
  db.prepare('INSERT INTO oauth_clients (client_id, redirect_uris, client_name, created_at) VALUES (?, ?, ?, ?)').run(
    clientId,
    JSON.stringify(redirectUris),
    clientName ?? null,
    createdAt,
  );
  return { clientId, redirectUris, clientName, createdAt };
}

export function findClient(db: DatabaseSync, clientId: string): OAuthClient | undefined {
  const row = db
    .prepare('SELECT client_id, redirect_uris, client_name, created_at FROM oauth_clients WHERE client_id = ?')
    .get(clientId) as ClientRow | undefined;
  return row ? toClient(row) : undefined;
}

/** Lembra que este usuário já aprovou este client, para pular a tela de consentimento nas próximas conexões. */
export function recordApproval(db: DatabaseSync, clientId: string, userId: string): void {
  db.prepare(
    'INSERT OR IGNORE INTO oauth_client_approvals (client_id, user_id, created_at) VALUES (?, ?, ?)',
  ).run(clientId, userId, new Date().toISOString());
}

export function hasApproval(db: DatabaseSync, clientId: string, userId: string): boolean {
  const row = db
    .prepare('SELECT 1 FROM oauth_client_approvals WHERE client_id = ? AND user_id = ?')
    .get(clientId, userId);
  return row !== undefined;
}
