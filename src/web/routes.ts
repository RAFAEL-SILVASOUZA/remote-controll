import { Router } from 'express';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Response } from 'express';
import { requireWebAuthPage, requireWebAuthApi } from '../auth/webAuth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', '..', 'public');

function toSessionJson(session: any) {
  return {
    id: session.id,
    clientName: session.clientName,
    workspace: session.workspace,
    status: session.status,
    messages: session.messages,
    pending: session.pending
      ? {
          id: session.pending.id,
          kind: session.pending.kind,
          options: session.pending.options,
          multiple: session.pending.multiple,
        }
      : null,
  };
}

function setupSse(res: Response) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
}

export function createWebRouter(store: any): Router {
  const router = Router();
  router.use(express.json());

  router.get('/', requireWebAuthPage, (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  router.get('/session/:id', requireWebAuthPage, (req, res) => {
    const session = store.getSession(req.params.id as string);
    if (!session || session.userId !== req.userId) {
      res.status(404).send('Sessão não encontrada.');
      return;
    }
    res.sendFile(path.join(publicDir, 'session.html'));
  });

  router.get('/api/sessions', requireWebAuthApi, (req, res) => {
    res.json(store.listSessions(req.userId!));
  });

  router.get('/events', requireWebAuthApi, (req, res) => {
    setupSse(res);
    const userId = req.userId!;
    const send = () => {
      res.write(`event: sessions\ndata: ${JSON.stringify(store.listSessions(userId))}\n\n`);
    };
    send();
    store.on('sessions-changed', send);
    req.on('close', () => store.off('sessions-changed', send));
  });

  router.get('/api/session/:id', requireWebAuthApi, (req, res) => {
    const session = store.getSession(req.params.id as string);
    if (!session || session.userId !== req.userId) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(toSessionJson(session));
  });

  router.get('/session/:id/events', requireWebAuthApi, (req, res) => {
    const id = req.params.id as string;
    const session = store.getSession(id);
    if (!session || session.userId !== req.userId) {
      res.status(404).end();
      return;
    }
    setupSse(res);
    const onMessage = (payload: { sessionId: string; message: unknown }) => {
      if (payload.sessionId !== id) return;
      const current = store.getSession(id);
      res.write(
        `event: update\ndata: ${JSON.stringify({ message: payload.message, session: current ? toSessionJson(current) : null })}\n\n`,
      );
    };
    store.on('session-message', onMessage);
    req.on('close', () => store.off('session-message', onMessage));
  });

  router.post('/api/session/:id/reply', requireWebAuthApi, (req, res) => {
    const id = req.params.id as string;
    const session = store.getSession(id);
    if (!session || session.userId !== req.userId) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const { requestId, ...rest } = req.body ?? {};
    try {
      let answer: any;
      if (typeof rest.text === 'string') {
        answer = { text: rest.text };
      } else {
        answer = { approved: Boolean(rest.approved), comment: rest.comment };
      }
      store.resolvePendingRequest(id, requestId, answer);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: 'internal_error' });
    }
  });

  return router;
}
