import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../db/index.js';
import { createUser } from '../db/users.js';
import { issueAgentToken } from '../db/agentTokens.js';
import { authenticateAgent, extractBearerToken } from './agentAuth.js';

test('extractBearerToken lê o header Authorization', () => {
  assert.equal(extractBearerToken({ authorization: 'Bearer abc123' }), 'abc123');
});

test('extractBearerToken retorna undefined sem header Bearer', () => {
  assert.equal(extractBearerToken({}), undefined);
  assert.equal(extractBearerToken({ authorization: 'Basic abc' }), undefined);
});

test('authenticateAgent resolve o userId de um token válido', () => {
  const db = createDb(':memory:');
  const user = createUser(db, 'a@a.com', 'hash');
  const { secret } = issueAgentToken(db, user.id, 'notebook');

  assert.equal(authenticateAgent(db, { authorization: `Bearer ${secret}` }), user.id);
});

test('authenticateAgent retorna undefined para token inválido', () => {
  const db = createDb(':memory:');
  assert.equal(authenticateAgent(db, { authorization: 'Bearer nao-existe' }), undefined);
});
