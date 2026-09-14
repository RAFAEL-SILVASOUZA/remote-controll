import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from './index.js';
import { createUser } from './users.js';
import { createWebSession, findUserIdByWebSession, deleteWebSession } from './webSessions.js';

test('createWebSession + findUserIdByWebSession', () => {
  const db = createDb(':memory:');
  const user = createUser(db, 'ana@example.com', 'hash123');
  const session = createWebSession(db, user.id);
  assert.equal(findUserIdByWebSession(db, session.id), user.id);
});

test('deleteWebSession invalida a sessão', () => {
  const db = createDb(':memory:');
  const user = createUser(db, 'ana@example.com', 'hash123');
  const session = createWebSession(db, user.id);
  deleteWebSession(db, session.id);
  assert.equal(findUserIdByWebSession(db, session.id), undefined);
});
