import { Router } from 'express';
import express from 'express';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { AskHumanAnswer, ConfirmActionAnswer, SessionStore } from '../sessions/store.js';
import { requireMcpAuth } from '../auth/mcpAuth.js';

function buildMcpServer(store: SessionStore): { server: McpServer; setSessionId: (id: string) => void } {
  let sessionId: string | undefined;
  const server = new McpServer({ name: 'remote-controll', version: '0.1.0' });

  server.tool(
    'ask_human',
    'Envia uma pergunta para o humano responsável, que recebe e responde pelo painel de controle remoto. Use quando precisar de uma informação, decisão ou preferência que só o humano sabe. Por padrão o humano responde em texto livre; informe "options" para transformar em múltipla escolha.',
    {
      question: z.string().describe('A pergunta exibida ao humano. Seja claro e direto — é a única coisa que ele vê de imediato.'),
      context: z.string().optional().describe('Informações extras para o humano entender a pergunta (ex.: o que está sendo feito, por quê). Opcional.'),
      options: z.array(z.string()).optional().describe('Lista de alternativas para o humano escolher, em vez de digitar uma resposta livre. Opcional — omita para pergunta de texto livre.'),
      multiple: z.boolean().optional().describe('Se true, o humano pode selecionar mais de uma opção em "options". Só tem efeito quando "options" é informado. Padrão: false (escolha única).'),
    },
    async ({ question, context, options, multiple }) => {
      if (!sessionId) throw new Error('Sessão MCP ainda não inicializada.');
      const text = context ? `${question}\n\n(${context})` : question;
      const answer = (await store.createPendingRequest(sessionId, 'ask_human', text, { options, multiple })) as AskHumanAnswer;
      return { content: [{ type: 'text' as const, text: answer.text }] };
    },
  );

  server.tool(
    'confirm_action',
    'Pede ao humano para aprovar ou rejeitar uma ação antes de executá-la. Use antes de qualquer ação sensível, destrutiva ou irreversível (ex.: apagar dados, enviar algo publicamente, gastar dinheiro) para obter permissão explícita.',
    {
      description: z.string().describe('Descrição curta e clara da ação que precisa de aprovação (ex.: "Apagar a tabela de usuários de teste").'),
      details: z.string().optional().describe('Detalhes adicionais para o humano avaliar a ação (ex.: escopo, impacto, alternativas consideradas). Opcional.'),
    },
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

export function createMcpRouter(store: SessionStore, db: DatabaseSync, publicBaseUrl: string): Router {
  const router = Router();
  router.use(express.json());
  router.use(requireMcpAuth(db, publicBaseUrl));

  const transports = new Map<string, StreamableHTTPServerTransport>();

  router.post('/', async (req, res) => {
    const headerSessionId = req.headers['mcp-session-id'];
    const existingId = typeof headerSessionId === 'string' ? headerSessionId : undefined;

    let transport = existingId ? transports.get(existingId) : undefined;
    if (transport && existingId) store.touchSession(existingId);

    if (!transport) {
      if (existingId || !isInitializeRequest(req.body)) {
        res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Bad Request: sessão MCP inválida ou ausente.' },
          id: null,
        });
        return;
      }

      const userId = req.userId!;
      const workspace = req.workspace ?? 'Desconhecido';
      const { server, setSessionId } = buildMcpServer(store);
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid: string) => {
          transports.set(sid, transport!);
          setSessionId(sid);
          const clientName = server.server.getClientVersion()?.name ?? 'Agente';
          store.createSession(sid, clientName, userId, workspace);
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
    if (sid) store.touchSession(sid);
    await transport.handleRequest(req, res);
  };

  router.get('/', handleSessionRequest);
  router.delete('/', handleSessionRequest);

  return router;
}
