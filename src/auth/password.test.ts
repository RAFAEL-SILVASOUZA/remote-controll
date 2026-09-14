import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from './password.js';

test('verifyPassword aceita a senha correta', () => {
  const stored = hashPassword('senha-correta-123');
  assert.equal(verifyPassword('senha-correta-123', stored), true);
});

test('verifyPassword rejeita senha errada', () => {
  const stored = hashPassword('senha-correta-123');
  assert.equal(verifyPassword('outra-senha', stored), false);
});
