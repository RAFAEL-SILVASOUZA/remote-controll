import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from './index.js';
import { registerClient, findClient } from './oauthClients.js';

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
