import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from './index.js';
import { registerClient, findClient, hasApproval, recordApproval } from './oauthClients.js';

test('registerClient + findClient', () => {
  const db = createDb(':memory:');
  const client = registerClient(db, ['http://localhost:8765/callback'], 'test-client');
  const found = findClient(db, client.clientId);
  assert.equal(found?.clientId, client.clientId);
  assert.deepEqual(found?.redirectUris, ['http://localhost:8765/callback']);
  assert.equal(found?.clientName, 'test-client');
});

test('findClient retorna undefined para client desconhecido', () => {
  const db = createDb(':memory:');
  assert.equal(findClient(db, 'nao-existe'), undefined);
});

test('hasApproval é false até recordApproval ser chamado para o par client+user', () => {
  const db = createDb(':memory:');
  const client = registerClient(db, ['http://localhost:8765/callback']);

  assert.equal(hasApproval(db, client.clientId, 'user-1'), false);

  recordApproval(db, client.clientId, 'user-1');

  assert.equal(hasApproval(db, client.clientId, 'user-1'), true);
  assert.equal(hasApproval(db, client.clientId, 'user-2'), false);
});

test('recordApproval é idempotente', () => {
  const db = createDb(':memory:');
  const client = registerClient(db, ['http://localhost:8765/callback']);

  recordApproval(db, client.clientId, 'user-1');
  recordApproval(db, client.clientId, 'user-1');

  assert.equal(hasApproval(db, client.clientId, 'user-1'), true);
});
