import type { Server as HttpServer } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import { WebSocketServer, WebSocket } from 'ws';
import { authenticateAgent } from '../auth/agentAuth.js';
import { wsInboundMessageSchema } from './protocol.js';
import { AgentHub } from './hub.js';

export const AGENT_WS_PATH = '/agent/ws';

export function attachAgentWsServer(httpServer: HttpServer, db: DatabaseSync, hub: AgentHub): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url ?? '', 'http://localhost');
    if (pathname !== AGENT_WS_PATH) return;

    const userId = authenticateAgent(db, req.headers);
    if (!userId) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      handleConnection(hub, userId, ws);
    });
  });

  return wss;
}

function handleConnection(hub: AgentHub, userId: string, ws: WebSocket): void {
  const connection = hub.registerConnection(userId, (data) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  });

  ws.on('message', (raw) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      return;
    }

    const result = wsInboundMessageSchema.safeParse(parsed);
    if (!result.success) {
      console.warn('Mensagem WS inválida recebida, ignorada:', result.error.message);
      return;
    }

    const message = result.data;
    if (message.type !== 'event') return;

    try {
      if (message.event === 'conversation_opened') {
        hub.openConversation(connection.id, message.payload.id, message.payload.title);
      } else if (message.event === 'conversation_closed') {
        hub.closeConversation(message.payload.id);
      } else if (message.event === 'snapshot') {
        hub.applySnapshot(message.payload.id, message.payload);
      }
    } catch {
      // Conversa desconhecida (snapshot antes do conversation_opened, ou já fechada) — ignora.
    }
  });

  ws.on('close', () => hub.removeConnection(connection.id));
  ws.on('error', () => hub.removeConnection(connection.id));
}
