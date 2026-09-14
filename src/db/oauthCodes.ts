import type { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';

const CODE_TTL_MS = 2 * 60 * 1000;

export interface AuthorizationCode {
  code: string;
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  createdAt: string;
  expiresAt: string;
}

interface CodeRow {
  code: string;
  client_id: string;
  user_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  created_at: string;
  expires_at: string;
  used: number;
}

export function createAuthorizationCode(
  db: DatabaseSync,
  params: {
    clientId: string;
    userId: string;
    redirectUri: string;
    codeChallenge: string;
    codeChallengeMethod: string;
  },
): AuthorizationCode {
  const code = randomBytes(32).toString('hex');
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + CODE_TTL_MS);
  db.prepare(
    `INSERT INTO oauth_authorization_codes
      (code, client_id, user_id, redirect_uri, code_challenge, code_challenge_method, created_at, expires_at, used)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
  ).run(
    code,
    params.clientId,
    params.userId,
    params.redirectUri,
    params.codeChallenge,
    params.codeChallengeMethod,
    createdAt.toISOString(),
    expiresAt.toISOString(),
  );
  return {
    code,
    clientId: params.clientId,
    userId: params.userId,
    redirectUri: params.redirectUri,
    codeChallenge: params.codeChallenge,
    codeChallengeMethod: params.codeChallengeMethod,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * Marks the code used and returns it. Throws a plain Error (mapped to
 * OAuth's `invalid_grant` by the route) for unknown/used/expired codes.
 */
export function consumeAuthorizationCode(db: DatabaseSync, code: string): AuthorizationCode {
  const row = db.prepare('SELECT * FROM oauth_authorization_codes WHERE code = ?').get(code) as CodeRow | undefined;
  if (!row) throw new Error('Código de autorização inválido.');
  if (row.used) throw new Error('Código de autorização já utilizado.');
  if (new Date(row.expires_at).getTime() <= Date.now()) throw new Error('Código de autorização expirado.');
  db.prepare('UPDATE oauth_authorization_codes SET used = 1 WHERE code = ?').run(code);
  return {
    code: row.code,
    clientId: row.client_id,
    userId: row.user_id,
    redirectUri: row.redirect_uri,
    codeChallenge: row.code_challenge,
    codeChallengeMethod: row.code_challenge_method,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}
