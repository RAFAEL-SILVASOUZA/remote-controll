import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from './index.js';
import { createUser, findUserByEmail, findUserById, EmailAlreadyRegisteredError } from './users.js';

test('createUser + findUserByEmail + findUserById', () => {
  const db = createDb(':memory:');
  const user = createUser(db, 'ana@example.com', 'hash123');
  assert.equal(findUserByEmail(db, 'ana@example.com')?.id, user.id);
  assert.equal(findUserById(db, user.id)?.email, 'ana@example.com');
});

test('createUser rejeita e-mail duplicado', () => {
  const db = createDb(':memory:');
  createUser(db, 'ana@example.com', 'hash123');
  assert.throws(() => createUser(db, 'ana@example.com', 'outrahash'), EmailAlreadyRegisteredError);
});
