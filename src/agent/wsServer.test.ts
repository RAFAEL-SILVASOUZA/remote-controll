import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { createDb } from '../db/index.js';
import { createUser } from '../db/users.js';
import { issueAgentToken } from '../db/agentTokens.js';
import { AgentHub } from './hub.js';
import { attachAgentWsServer, AGENT_WS_PATH } from './wsServer.js';

function startServer() {
  const db = createDb(':memory:');
  const hub = new AgentHub();
  const server = http.createServer();
  attachAgentWsServer(server, db, hub);
  return new Promise<{ db: ReturnType<typeof createDb>; hub: AgentHub; port: number; close: () => Promise<void> }>(
    (resolve) => {
      server.listen(0, () => {
        const { port } = server.address() as AddressInfo;
        resolve({ db, hub, port, close: () => new Promise((r) => server.close(() => r())) });
      });
    },
  );
}

function waitUntil(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error('timeout esperando condição'));
        return;
      }
      setTimeout(check, 10);
    };
    check();
  });
}

test('conexão sem token é recusada com 401', async () => {
  const { port, close } = await startServer();
  const ws = new WebSocket(`ws://localhost:${port}${AGENT_WS_PATH}`);

  await new Promise<void>((resolve) => {
    ws.on('unexpected-response', (_req, res) => {
      assert.equal(res.statusCode, 401);
      resolve();
    });
  });

  await close();
});

test('conexão autenticada registra a conversa aberta no hub', async () => {
  const { db, hub, port, close } = await startServer();
  const user = createUser(db, 'test-user-1@example.com', 'hash');
  const { secret } = issueAgentToken(db, user.id, 'teste');
  const ws = new WebSocket(`ws://localhost:${port}${AGENT_WS_PATH}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });

  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve());
    ws.on('error', reject);
  });

  ws.send(JSON.stringify({ type: 'event', event: 'conversation_opened', payload: { id: 'c1', title: 'Teste' } }));

  await waitUntil(() => hub.listConversations(user.id).length === 1);
  assert.equal(hub.listConversations(user.id)[0].id, 'c1');

  ws.close();
  await close();
});

test('hub.sendCommand entrega o comando pro socket certo', async () => {
  const { db, hub, port, close } = await startServer();
  const user = createUser(db, 'test-user-2@example.com', 'hash');
  const { secret } = issueAgentToken(db, user.id, 'teste');
  const ws = new WebSocket(`ws://localhost:${port}${AGENT_WS_PATH}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });

  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve());
    ws.on('error', reject);
  });
  ws.send(JSON.stringify({ type: 'event', event: 'conversation_opened', payload: { id: 'c1' } }));
  await waitUntil(() => hub.listConversations(user.id).length === 1);

  const received = new Promise<{ type: string; operation: string }>((resolve) => {
    ws.on('message', (raw) => resolve(JSON.parse(raw.toString())));
  });
  hub.sendCommand({ operation: 'stop_response', payload: { id: 'c1' } });

  const message = await received;
  assert.equal(message.type, 'command');
  assert.equal(message.operation, 'stop_response');

  ws.close();
  await close();
});
