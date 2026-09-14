import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createDb } from './index.js';
import { createUser } from './users.js';
import { createToken, findUserIdByToken } from './tokens.js';

test('createToken + findUserIdByToken', () => {
  const db = createDb(':memory:');
  const user = createUser(db, 'ana@example.com', 'hash123');
  const { token } = createToken(db, user.id);
  assert.equal(findUserIdByToken(db, token), user.id);
});

test('findUserIdByToken retorna undefined para token desconhecido', () => {
  const db = createDb(':memory:');
  assert.equal(findUserIdByToken(db, 'token-que-nao-existe'), undefined);
});

test('findUserIdByToken retorna undefined para token expirado', () => {
  const db = createDb(':memory:');
  const user = createUser(db, 'ana@example.com', 'hash123');
  const { token } = createToken(db, user.id);
  const tokenHash = createHash('sha256').update(token).digest('hex');
  db.prepare('UPDATE mcp_tokens SET expires_at = ? WHERE token_hash = ?').run(
    new Date(Date.now() - 1000).toISOString(),
    tokenHash,
  );
  assert.equal(findUserIdByToken(db, token), undefined);
});
