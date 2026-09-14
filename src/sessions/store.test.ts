import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionStore, PendingMismatchError, SessionNotFoundError, InvalidAnswerError } from './store.js';

test('createPendingRequest resolves via resolvePendingRequest with matching requestId', async () => {
  const store = new SessionStore();
  store.createSession('s1', 'Agente Teste', 'user-1', 'D:/ws');

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
  store.createSession('s2', 'Agente Teste', 'user-1', 'D:/ws');
  store.createPendingRequest('s2', 'ask_human', 'Pergunta');

  assert.throws(() => store.resolvePendingRequest('s2', 'id-errado', { text: 'x' }), PendingMismatchError);
});

test('resolvePendingRequest rejeita sessão inexistente', () => {
  const store = new SessionStore();
  assert.throws(() => store.resolvePendingRequest('nao-existe', 'qualquer', { text: 'x' }), SessionNotFoundError);
});

test('removeSession rejeita a pending request em aberto', async () => {
  const store = new SessionStore();
  store.createSession('s3', 'Agente Teste', 'user-1', 'D:/ws');
  const pendingPromise = store.createPendingRequest('s3', 'confirm_action', 'Confirma?');

  store.removeSession('s3');

  await assert.rejects(pendingPromise, /desconectada/);
  assert.equal(store.getSession('s3')?.status, 'disconnected');
});

test('listSessions só retorna sessões do userId informado', () => {
  const store = new SessionStore();
  store.createSession('sa', 'Agente A', 'user-1', 'D:/ws-a');
  store.createSession('sb', 'Agente B', 'user-2', 'D:/ws-b');

  const forUser1 = store.listSessions('user-1');
  assert.equal(forUser1.length, 1);
  assert.equal(forUser1[0].id, 'sa');
  assert.equal(forUser1[0].workspace, 'D:/ws-a');
});

test('resolvePendingRequest valida resposta de escolha única', async () => {
  const store = new SessionStore();
  store.createSession('s4', 'Agente Teste', 'user-1', 'D:/ws');
  const pendingPromise = store.createPendingRequest('s4', 'ask_human', 'Qual cor?', {
    options: ['Vermelho', 'Azul'],
  });
  const requestId = store.getSession('s4')!.pending!.id;

  assert.throws(() => store.resolvePendingRequest('s4', requestId, { text: 'Verde' }), InvalidAnswerError);

  store.resolvePendingRequest('s4', requestId, { text: 'Azul' });
  assert.deepEqual(await pendingPromise, { text: 'Azul' });
});

test('resolvePendingRequest valida resposta de escolha múltipla', async () => {
  const store = new SessionStore();
  store.createSession('s5', 'Agente Teste', 'user-1', 'D:/ws');
  const pendingPromise = store.createPendingRequest('s5', 'ask_human', 'Quais frutas?', {
    options: ['Maçã', 'Banana', 'Uva'],
    multiple: true,
  });
  const requestId = store.getSession('s5')!.pending!.id;

  store.resolvePendingRequest('s5', requestId, { text: 'Maçã, Uva' });
  assert.deepEqual(await pendingPromise, { text: 'Maçã, Uva' });
});

test('sweepStaleSessions desconecta sessões inativas além do limite', () => {
  const store = new SessionStore();
  store.createSession('s6', 'Agente Teste', 'user-1', 'D:/ws');
  const session = store.getSession('s6')!;
  session.lastSeenAt = new Date(Date.now() - 10_000).toISOString();

  store.sweepStaleSessions(5_000);
  assert.equal(store.getSession('s6')?.status, 'disconnected');
});

test('sweepStaleSessions não mexe em sessão recém-ativa', () => {
  const store = new SessionStore();
  store.createSession('s7', 'Agente Teste', 'user-1', 'D:/ws');
  store.sweepStaleSessions(60_000);
  assert.equal(store.getSession('s7')?.status, 'idle');
});

test('touchSession atualiza lastSeenAt e evita desconexão pelo sweep', () => {
  const store = new SessionStore();
  store.createSession('s8', 'Agente Teste', 'user-1', 'D:/ws');
  const session = store.getSession('s8')!;
  session.lastSeenAt = new Date(Date.now() - 10_000).toISOString();
  store.touchSession('s8');
  store.sweepStaleSessions(5_000);
  assert.equal(store.getSession('s8')?.status, 'idle');
});
