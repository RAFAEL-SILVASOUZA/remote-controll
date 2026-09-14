import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifyPkce } from './pkce.js';

test('verifyPkce aceita o par verifier/challenge correto (S256)', () => {
  const verifier = 'um-code-verifier-bem-aleatorio-de-teste-1234567890';
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  assert.equal(verifyPkce(verifier, challenge, 'S256'), true);
});

test('verifyPkce rejeita verifier incorreto', () => {
  const verifier = 'verifier-certo';
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  assert.equal(verifyPkce('verifier-errado', challenge, 'S256'), false);
});

test('verifyPkce rejeita method diferente de S256', () => {
  const verifier = 'qualquer-coisa';
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  assert.equal(verifyPkce(verifier, challenge, 'plain'), false);
});
