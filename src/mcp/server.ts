import { Router } from 'express';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { AskHumanAnswer, ConfirmActionAnswer, SessionStore } from '../sessions/store.js';

function buildMcpServer(store: SessionStore): { server: McpServer; setSessionId: (id: string) => void } {
  let sessionId: string | undefined;
  const server = new McpServer({ name: 'remote-controll', version: '0.1.0' });

  server.tool(
    'ask_human',
    'Pergunta algo em texto livre para o humano responsável e espera a resposta.',
    { question: z.string(), context: z.string().optional() },
    async ({ question, context }) => {
      if (!sessionId) throw new Error('Sessão MCP ainda não inicializada.');
      const text = context ? `${question}\n\n(${context})` : question;
      const answer = (await store.createPendingRequest(sessionId, 'ask_human', text)) as AskHumanAnswer;
      return { content: [{ type: 'text' as const, text: answer.text }] };
    },
  );

  server.tool(
    'confirm_action',
    'Pede confirmação (aprovar/rejeitar) de uma ação antes de executá-la.',
    { description: z.string(), details: z.string().optional() },
    async ({ description, details }) => {
      if (!sessionId) throw new Error('Sessão MCP ainda não inicializada.');
      const text = details ? `${description}\n\n${details}` : description;
      const answer = (await store.createPendingRequest(sessionId, 'confirm_action', text)) as ConfirmActionAnswer;
      const resultText = answer.approved
        ? `Aprovado.${answer.comment ? ` Comentário: ${answer.comment}` : ''}`
        : `Rejeitado.${answer.comment ? ` Motivo: ${answer.comment}` : ''}`;
      return { content: [{ type: 'text' as const, text: resultText }] };
    },
  );

  return { server, setSessionId: (id: string) => { sessionId = id; } };
}

export function createMcpRouter(store: SessionStore): Router {
  const router = Router();
  router.use(express.json());

  const transports = new Map<string, StreamableHTTPServerTransport>();

  router.post('/', async (req, res) => {
    const headerSessionId = req.headers['mcp-session-id'];
    const existingId = typeof headerSessionId === 'string' ? headerSessionId : undefined;

    let transport = existingId ? transports.get(existingId) : undefined;

    if (!transport) {
      if (existingId || !isInitializeRequest(req.body)) {
        res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Bad Request: sessão MCP inválida ou ausente.' },
          id: null,
        });
        return;
      }

      const { server, setSessionId } = buildMcpServer(store);
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid: string) => {
          transports.set(sid, transport!);
          setSessionId(sid);
          const clientName = server.server.getClientVersion()?.name ?? 'Agente';
          store.createSession(sid, clientName);
        },
      });

      transport.onclose = () => {
        const sid = transport!.sessionId;
        if (sid) {
          transports.delete(sid);
          store.removeSession(sid);
        }
      };

      await server.connect(transport);
    }

    await transport.handleRequest(req, res, req.body);
  });

  const handleSessionRequest = async (req: express.Request, res: express.Response) => {
    const headerSessionId = req.headers['mcp-session-id'];
    const sid = typeof headerSessionId === 'string' ? headerSessionId : undefined;
    const transport = sid ? transports.get(sid) : undefined;
    if (!transport) {
      res.status(400).send('Sessão MCP inválida ou ausente.');
      return;
    }
    await transport.handleRequest(req, res);
  };

  router.get('/', handleSessionRequest);
  router.delete('/', handleSessionRequest);

  return router;
}
