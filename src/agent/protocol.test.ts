import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wsInboundMessageSchema, sendMessageCommandSchema, answerQuestionCommandSchema } from './protocol.js';

test('wsInboundMessageSchema aceita conversation_opened válido', () => {
  const result = wsInboundMessageSchema.safeParse({
    type: 'event',
    event: 'conversation_opened',
    payload: { id: 'c1', title: 'Teste' },
  });
  assert.equal(result.success, true);
});

test('wsInboundMessageSchema aceita snapshot com activity e pendingQuestion', () => {
  const result = wsInboundMessageSchema.safeParse({
    type: 'event',
    event: 'snapshot',
    payload: {
      id: 'c1',
      status: 'waiting_user',
      activity: [{ id: 'a1', kind: 'tool_call', text: 'Lendo arquivo', createdAt: new Date().toISOString() }],
      pendingQuestion: {
        messageId: 'm1',
        questions: [
          {
            id: 'q1',
            question: 'Continuar?',
            type: 'radio',
            options: [
              { value: 'sim', label: 'Sim' },
              { value: 'nao', label: 'Não' },
            ],
            default: 'sim',
          },
        ],
      },
    },
  });
  assert.equal(result.success, true);
});

test('wsInboundMessageSchema rejeita payload sem id', () => {
  const result = wsInboundMessageSchema.safeParse({ type: 'event', event: 'conversation_closed', payload: {} });
  assert.equal(result.success, false);
});

test('sendMessageCommandSchema exige message não vazio', () => {
  const result = sendMessageCommandSchema.safeParse({
    type: 'command',
    requestId: 'r1',
    operation: 'send_message',
    payload: { id: 'c1', message: '' },
  });
  assert.equal(result.success, false);
});

test('answerQuestionCommandSchema aceita skipped sem answers', () => {
  const result = answerQuestionCommandSchema.safeParse({
    type: 'command',
    requestId: 'r1',
    operation: 'answer_question',
    payload: { id: 'c1', messageId: 'm1', skipped: true },
  });
  assert.equal(result.success, true);
});
