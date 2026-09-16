import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';

const baseUrl = process.env.REMOTE_CONTROLL_URL ?? 'http://localhost:5002';
const token = process.env.REMOTE_CONTROLL_TOKEN;

if (!token) {
  console.error('Defina REMOTE_CONTROLL_TOKEN (gere um token em /tokens) antes de rodar.');
  process.exit(1);
}

const wsUrl = `${baseUrl.replace(/^http/, 'ws')}/agent/ws`;
const ws = new WebSocket(wsUrl, { headers: { Authorization: `Bearer ${token}` } });
const conversationId = `fake-${randomUUID()}`;

// O vide-code de verdade acumula a activity da conversa inteira e reenvia o array
// completo a cada snapshot (não um delta) — o fake replica esse comportamento
// pra exercitar o AgentHub do jeito real.
const activityLog: { id: string; kind: 'tool_call'; text: string; createdAt: string }[] = [];

function send(message: unknown): void {
  ws.send(JSON.stringify(message));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function simulateTurn(userMessage: string): Promise<void> {
  send({ type: 'event', event: 'snapshot', payload: { id: conversationId, status: 'queued' } });
  await delay(300);

  activityLog.push({ id: randomUUID(), kind: 'tool_call', text: 'Lendo arquivo fake.ts', createdAt: new Date().toISOString() });
  send({
    type: 'event',
    event: 'snapshot',
    payload: {
      id: conversationId,
      status: 'streaming',
      activity: [...activityLog],
      message: { role: 'assistant', content: `Recebi: "${userMessage}"` },
    },
  });
  await delay(300);

  if (userMessage.toLowerCase().includes('pergunta')) {
    send({
      type: 'event',
      event: 'snapshot',
      payload: {
        id: conversationId,
        status: 'waiting_user',
        pendingQuestion: {
          messageId: `askuser-${randomUUID()}`,
          questions: [
            {
              id: 'cor',
              question: 'Qual cor você prefere?',
              type: 'radio',
              options: [
                { value: 'azul', label: 'Azul' },
                { value: 'verde', label: 'Verde' },
              ],
              default: 'azul',
            },
          ],
        },
      },
    });
    return;
  }

  send({
    type: 'event',
    event: 'snapshot',
    payload: {
      id: conversationId,
      status: 'completed',
      message: { role: 'assistant', content: `Recebi: "${userMessage}". Pronto.` },
    },
  });
}

ws.on('open', () => {
  console.log('Conectado ao remote-controll. Conversa fake:', conversationId);
  send({ type: 'event', event: 'conversation_opened', payload: { id: conversationId, title: 'Conversa de teste' } });
});

ws.on('message', (raw) => {
  const message = JSON.parse(raw.toString());
  console.log('Comando recebido:', message);
  if (message.type !== 'command') return;

  if (message.operation === 'send_message') {
    void simulateTurn(message.payload.message);
  } else if (message.operation === 'stop_response') {
    send({ type: 'event', event: 'snapshot', payload: { id: conversationId, status: 'cancelled' } });
  } else if (message.operation === 'answer_question') {
    console.log('Pergunta respondida:', message.payload);
    send({
      type: 'event',
      event: 'snapshot',
      payload: { id: conversationId, status: 'completed', message: { role: 'assistant', content: 'Obrigado pela resposta.' } },
    });
  }
});

ws.on('close', () => console.log('Conexão fechada.'));
ws.on('error', (err) => console.error('Erro na conexão:', err));
