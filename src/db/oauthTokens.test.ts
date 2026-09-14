import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createDb } from './index.js';
import { createUser } from './users.js';
import { registerClient } from './oauthClients.js';
import { issueTokens, findUserIdByAccessToken, rotateRefreshToken } from './oauthTokens.js';

function setup() {
  const db = createDb(':memory:');
  const user = createUser(db, 'ana@example.com', 'hash123');
  const client = registerClient(db, ['http://localhost:8765/callback']);
  return { db, user, client };
}

test('issueTokens + findUserIdByAccessToken', () => {
  const { db, user, client } = setup();
  const tokens = issueTokens(db, client.clientId, user.id);
  assert.equal(findUserIdByAccessToken(db, tokens.accessToken), user.id);
});

test('findUserIdByAccessToken retorna undefined para token expirado', () => {
  const { db, user, client } = setup();
  const tokens = issueTokens(db, client.clientId, user.id);
  const hash = createHash('sha256').update(tokens.accessToken).digest('hex');
  db.prepare('UPDATE oauth_access_tokens SET expires_at = ? WHERE token_hash = ?').run(
    new Date(Date.now() - 1000).toISOString(),
    hash,
  );
  assert.equal(findUserIdByAccessToken(db, tokens.accessToken), undefined);
});

test('rotateRefreshToken invalida o refresh token antigo e emite um novo par', () => {
  const { db, user, client } = setup();
  const first = issueTokens(db, client.clientId, user.id);

  const second = rotateRefreshToken(db, first.refreshToken, client.clientId);
  assert.equal(findUserIdByAccessToken(db, second.accessToken), user.id);
  assert.notEqual(second.accessToken, first.accessToken);
  assert.notEqual(second.refreshToken, first.refreshToken);

  assert.throws(() => rotateRefreshToken(db, first.refreshToken, client.clientId), /inválido/);
});

test('rotateRefreshToken rejeita client_id que não bate com o token', () => {
  const { db, user, client } = setup();
  const tokens = issueTokens(db, client.clientId, user.id);
  assert.throws(() => rotateRefreshToken(db, tokens.refreshToken, 'outro-client-id'), /não pertence/);
});
