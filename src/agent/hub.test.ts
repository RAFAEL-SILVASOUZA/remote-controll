import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentHub, ConversationNotFoundError, ConnectionUnavailableError } from './hub.js';

test('openConversation cria conversa vinculada ao usuário da conexão', () => {
  const hub = new AgentHub();
  const connection = hub.registerConnection('user-1', () => {});
  const conversation = hub.openConversation(connection.id, 'c1', 'Título');
  assert.equal(conversation.status, 'idle');
  assert.deepEqual(conversation.activity, []);
  assert.deepEqual(conversation.history, []);
  assert.equal(conversation.userId, 'user-1');
});

test('listConversations só retorna conversas do userId informado', () => {
  const hub = new AgentHub();
  const connectionA = hub.registerConnection('user-1', () => {});
  const connectionB = hub.registerConnection('user-2', () => {});
  hub.openConversation(connectionA.id, 'ca', 'A');
  hub.openConversation(connectionB.id, 'cb', 'B');

  const forUser1 = hub.listConversations('user-1');
  assert.equal(forUser1.length, 1);
  assert.equal(forUser1[0].id, 'ca');
});

test('closeConversation remove a conversa da listagem', () => {
  const hub = new AgentHub();
  const connection = hub.registerConnection('user-1', () => {});
  hub.openConversation(connection.id, 'c1');
  hub.closeConversation('c1');
  assert.equal(hub.getConversation('c1'), undefined);
});

test('applySnapshot substitui activity pelo array recebido (o vide-code manda o acumulado inteiro, não um delta)', () => {
  const hub = new AgentHub();
  const connection = hub.registerConnection('user-1', () => {});
  hub.openConversation(connection.id, 'c1');

  hub.applySnapshot('c1', {
    id: 'c1',
    status: 'streaming',
    activity: [{ id: 'a1', kind: 'tool_call', text: 'passo 1', createdAt: new Date().toISOString() }],
  });
  hub.applySnapshot('c1', {
    id: 'c1',
    status: 'streaming',
    activity: [
      { id: 'a1', kind: 'tool_call', text: 'passo 1', createdAt: new Date().toISOString() },
      { id: 'a2', kind: 'tool_call', text: 'passo 2', createdAt: new Date().toISOString() },
    ],
  });

  const conversation = hub.getConversation('c1')!;
  assert.equal(conversation.activity.length, 2);
  assert.equal(conversation.activity[0].id, 'a1');
  assert.equal(conversation.activity[1].id, 'a2');
});

test('applySnapshot sem activity no payload preserva a activity já registrada', () => {
  const hub = new AgentHub();
  const connection = hub.registerConnection('user-1', () => {});
  hub.openConversation(connection.id, 'c1');

  hub.applySnapshot('c1', {
    id: 'c1',
    status: 'streaming',
    activity: [{ id: 'a1', kind: 'tool_call', text: 'passo 1', createdAt: new Date().toISOString() }],
  });
  hub.applySnapshot('c1', { id: 'c1', status: 'completed', message: { role: 'assistant', content: 'ok' } });

  const conversation = hub.getConversation('c1')!;
  assert.equal(conversation.activity.length, 1);
});

test('applySnapshot registra o turno do agente em history ao terminar', () => {
  const hub = new AgentHub();
  const connection = hub.registerConnection('user-1', () => {});
  hub.openConversation(connection.id, 'c1');

  hub.applySnapshot('c1', { id: 'c1', status: 'streaming', message: { role: 'assistant', content: 'parcial' } });
  hub.applySnapshot('c1', { id: 'c1', status: 'completed', message: { role: 'assistant', content: 'final' } });

  const conversation = hub.getConversation('c1')!;
  assert.equal(conversation.history.length, 1);
  assert.equal(conversation.history[0].role, 'agent');
  assert.equal(conversation.history[0].text, 'final');
  assert.equal(conversation.message, undefined);
});

test('applySnapshot lança ConversationNotFoundError para conversa desconhecida', () => {
  const hub = new AgentHub();
  assert.throws(() => hub.applySnapshot('nope', { id: 'nope', status: 'idle' }), ConversationNotFoundError);
});

test('removeConnection marca as conversas da conexão como disconnected sem apagá-las', () => {
  const hub = new AgentHub();
  const connection = hub.registerConnection('user-1', () => {});
  hub.openConversation(connection.id, 'c1');

  hub.removeConnection(connection.id);

  const conversation = hub.getConversation('c1');
  assert.equal(conversation?.status, 'disconnected');
});

test('sendCommand lança ConnectionUnavailableError quando a conexão caiu', () => {
  const hub = new AgentHub();
  const connection = hub.registerConnection('user-1', () => {});
  hub.openConversation(connection.id, 'c1');
  hub.removeConnection(connection.id);

  assert.throws(
    () => hub.sendCommand({ operation: 'stop_response', payload: { id: 'c1' } }),
    ConnectionUnavailableError,
  );
});

test('sendCommand lança ConversationNotFoundError para conversa desconhecida', () => {
  const hub = new AgentHub();
  assert.throws(
    () => hub.sendCommand({ operation: 'stop_response', payload: { id: 'nope' } }),
    ConversationNotFoundError,
  );
});

test('sendCommand de send_message registra a mensagem do humano em history e envia pela conexão', () => {
  const hub = new AgentHub();
  const sent: string[] = [];
  const connection = hub.registerConnection('user-1', (data) => sent.push(data));
  hub.openConversation(connection.id, 'c1');

  hub.sendCommand({ operation: 'send_message', payload: { id: 'c1', message: 'oi' } });

  const conversation = hub.getConversation('c1')!;
  assert.equal(conversation.history.length, 1);
  assert.equal(conversation.history[0].role, 'human');
  assert.equal(conversation.history[0].text, 'oi');
  assert.equal(sent.length, 1);
  const parsed = JSON.parse(sent[0]);
  assert.equal(parsed.type, 'command');
  assert.equal(parsed.operation, 'send_message');
  assert.equal(parsed.payload.message, 'oi');
});
