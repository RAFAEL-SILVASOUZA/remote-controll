import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionStore, PendingMismatchError, SessionNotFoundError } from './store.js';

test('createPendingRequest resolves via resolvePendingRequest with matching requestId', async () => {
  const store = new SessionStore();
  store.createSession('s1', 'Agente Teste');

  const pendingPromise = store.createPendingRequest('s1', 'ask_human', 'Qual é a cor do céu?');
  const session = store.getSession('s1');
  assert.ok(session?.pending);
  const requestId = session!.pending!.id;

  store.resolvePendingRequest('s1', requestId, { text: 'Azul' });

  const answer = await pendingPromise;
  assert.deepEqual(answer, { text: 'Azul' });
  assert.equal(store.getSession('s1')?.status, 'idle');
});

test('resolvePendingRequest rejeita requestId que não é o pendente atual', () => {
  const store = new SessionStore();
  store.createSession('s2', 'Agente Teste');
  store.createPendingRequest('s2', 'ask_human', 'Pergunta');

  assert.throws(() => store.resolvePendingRequest('s2', 'id-errado', { text: 'x' }), PendingMismatchError);
});

test('resolvePendingRequest rejeita sessão inexistente', () => {
  const store = new SessionStore();
  assert.throws(() => store.resolvePendingRequest('nao-existe', 'qualquer', { text: 'x' }), SessionNotFoundError);
});

test('removeSession rejeita a pending request em aberto', async () => {
  const store = new SessionStore();
  store.createSession('s3', 'Agente Teste');
  const pendingPromise = store.createPendingRequest('s3', 'confirm_action', 'Confirma?');

  store.removeSession('s3');

  await assert.rejects(pendingPromise, /desconectada/);
  assert.equal(store.getSession('s3')?.status, 'disconnected');
});
