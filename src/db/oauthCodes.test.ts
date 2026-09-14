import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from './index.js';
import { createUser } from './users.js';
import { registerClient } from './oauthClients.js';
import { createAuthorizationCode, consumeAuthorizationCode } from './oauthCodes.js';

function setup() {
  const db = createDb(':memory:');
  const user = createUser(db, 'ana@example.com', 'hash123');
  const client = registerClient(db, ['http://localhost:8765/callback']);
  return { db, user, client };
}

test('createAuthorizationCode + consumeAuthorizationCode', () => {
  const { db, user, client } = setup();
  const created = createAuthorizationCode(db, {
    clientId: client.clientId,
    userId: user.id,
    redirectUri: 'http://localhost:8765/callback',
    codeChallenge: 'challenge-abc',
    codeChallengeMethod: 'S256',
  });

  const consumed = consumeAuthorizationCode(db, created.code);
  assert.equal(consumed.userId, user.id);
  assert.equal(consumed.clientId, client.clientId);
  assert.equal(consumed.codeChallenge, 'challenge-abc');
});

test('consumeAuthorizationCode rejeita reuso do mesmo código', () => {
  const { db, user, client } = setup();
  const created = createAuthorizationCode(db, {
    clientId: client.clientId,
    userId: user.id,
    redirectUri: 'http://localhost:8765/callback',
    codeChallenge: 'challenge-abc',
    codeChallengeMethod: 'S256',
  });

  consumeAuthorizationCode(db, created.code);
  assert.throws(() => consumeAuthorizationCode(db, created.code), /já utilizado/);
});

test('consumeAuthorizationCode rejeita código inexistente', () => {
  const { db } = setup();
  assert.throws(() => consumeAuthorizationCode(db, 'codigo-que-nao-existe'), /inválido/);
});

test('consumeAuthorizationCode rejeita código expirado', () => {
  const { db, user, client } = setup();
  const created = createAuthorizationCode(db, {
    clientId: client.clientId,
    userId: user.id,
    redirectUri: 'http://localhost:8765/callback',
    codeChallenge: 'challenge-abc',
    codeChallengeMethod: 'S256',
  });
  db.prepare('UPDATE oauth_authorization_codes SET expires_at = ? WHERE code = ?').run(
    new Date(Date.now() - 1000).toISOString(),
    created.code,
  );
  assert.throws(() => consumeAuthorizationCode(db, created.code), /expirado/);
});
