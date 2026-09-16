import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from './index.js';
import { createUser } from './users.js';
import { issueAgentToken, findUserIdByAgentToken, listAgentTokens, revokeAgentToken } from './agentTokens.js';

test('issueAgentToken + findUserIdByAgentToken', () => {
  const db = createDb(':memory:');
  const user = createUser(db, 'a@a.com', 'hash');
  const { secret } = issueAgentToken(db, user.id, 'notebook');
  assert.equal(findUserIdByAgentToken(db, secret), user.id);
});

test('findUserIdByAgentToken retorna undefined para token desconhecido', () => {
  const db = createDb(':memory:');
  assert.equal(findUserIdByAgentToken(db, 'nao-existe'), undefined);
});

test('listAgentTokens só retorna tokens do usuário', () => {
  const db = createDb(':memory:');
  const userA = createUser(db, 'a@a.com', 'hash');
  const userB = createUser(db, 'b@b.com', 'hash');
  issueAgentToken(db, userA.id, 'a-token');
  issueAgentToken(db, userB.id, 'b-token');

  const tokens = listAgentTokens(db, userA.id);
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].label, 'a-token');
});

test('revokeAgentToken remove o token e retorna true', () => {
  const db = createDb(':memory:');
  const user = createUser(db, 'a@a.com', 'hash');
  const { token, secret } = issueAgentToken(db, user.id, 'notebook');

  assert.equal(revokeAgentToken(db, user.id, token.id), true);
  assert.equal(findUserIdByAgentToken(db, secret), undefined);
});

test('revokeAgentToken retorna false para token de outro usuário', () => {
  const db = createDb(':memory:');
  const userA = createUser(db, 'a@a.com', 'hash');
  const userB = createUser(db, 'b@b.com', 'hash');
  const { token } = issueAgentToken(db, userA.id, 'notebook');

  assert.equal(revokeAgentToken(db, userB.id, token.id), false);
});
