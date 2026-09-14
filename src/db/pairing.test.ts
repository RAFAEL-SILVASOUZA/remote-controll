import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from './index.js';
import { createUser } from './users.js';
import { createPairing, getPairing, approvePairing, rejectPairing, PairingNotPendingError } from './pairing.js';
import { findUserIdByToken } from './tokens.js';

test('createPairing + getPairing', () => {
  const db = createDb(':memory:');
  const pairing = createPairing(db, 'D:/projetos/x');
  assert.equal(getPairing(db, pairing.code)?.status, 'pending');
  assert.equal(getPairing(db, pairing.code)?.workspace, 'D:/projetos/x');
});

test('approvePairing gera um token válido para o usuário', () => {
  const db = createDb(':memory:');
  const user = createUser(db, 'ana@example.com', 'hash123');
  const pairing = createPairing(db, undefined);
  const approved = approvePairing(db, pairing.code, user.id);
  assert.equal(approved.status, 'approved');
  assert.ok(approved.token);
  assert.equal(findUserIdByToken(db, approved.token!), user.id);
});

test('approvePairing rejeita pairing que não está pendente', () => {
  const db = createDb(':memory:');
  const user = createUser(db, 'ana@example.com', 'hash123');
  const pairing = createPairing(db, undefined);
  approvePairing(db, pairing.code, user.id);
  assert.throws(() => approvePairing(db, pairing.code, user.id), PairingNotPendingError);
});

test('rejectPairing marca como rejeitado', () => {
  const db = createDb(':memory:');
  const pairing = createPairing(db, undefined);
  const rejected = rejectPairing(db, pairing.code);
  assert.equal(rejected.status, 'rejected');
});
