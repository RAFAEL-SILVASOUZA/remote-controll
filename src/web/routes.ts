import { Router } from 'express';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Response } from 'express';
import { SessionNotFoundError, PendingMismatchError } from '../sessions/store.js';
import type { AskHumanAnswer, ConfirmActionAnswer, PendingAnswer, Session, SessionStore } from '../sessions/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', '..', 'public');

function toSessionJson(session: Session) {
  return {
    id: session.id,
    clientName: session.clientName,
    connectedAt: session.connectedAt,
    status: session.status,
    messages: session.messages,
    pending: session.pending ? { id: session.pending.id, kind: session.pending.kind } : null,
  };
}

function setupSse(res: Response) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
}

export function createWebRouter(store: SessionStore): Router {
  const router = Router();
  router.use(express.json());

  router.get('/session/:id', (req, res) => {
    if (!store.getSession(req.params.id)) {
      res.status(404).send('Sessão não encontrada.');
      return;
    }
    res.sendFile(path.join(publicDir, 'session.html'));
  });

  router.get('/api/sessions', (_req, res) => {
    res.json(store.listSessions());
  });

  router.get('/events', (req, res) => {
    setupSse(res);
    const send = (sessions: ReturnType<SessionStore['listSessions']>) => {
      res.write(`event: sessions\ndata: ${JSON.stringify(sessions)}\n\n`);
    };
    send(store.listSessions());
    store.on('sessions-changed', send);
    req.on('close', () => store.off('sessions-changed', send));
  });

  router.get('/api/session/:id', (req, res) => {
    const session = store.getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(toSessionJson(session));
  });

  router.get('/session/:id/events', (req, res) => {
    const { id } = req.params;
    if (!store.getSession(id)) {
      res.status(404).end();
      return;
    }
    setupSse(res);
    const onMessage = (payload: { sessionId: string; message: unknown }) => {
      if (payload.sessionId !== id) return;
      const session = store.getSession(id);
      res.write(
        `event: update\ndata: ${JSON.stringify({ message: payload.message, session: session ? toSessionJson(session) : null })}\n\n`,
      );
    };
    store.on('session-message', onMessage);
    req.on('close', () => store.off('session-message', onMessage));
  });

  router.post('/api/session/:id/reply', (req, res) => {
    const { id } = req.params;
    const { requestId, ...rest } = req.body ?? {};
    try {
      let answer: PendingAnswer;
      if (typeof rest.text === 'string') {
        answer = { text: rest.text } satisfies AskHumanAnswer;
      } else {
        answer = { approved: Boolean(rest.approved), comment: rest.comment } satisfies ConfirmActionAnswer;
      }
      store.resolvePendingRequest(id, requestId, answer);
      res.json({ ok: true });
    } catch (err) {
      if (err instanceof SessionNotFoundError) {
        res.status(404).json({ error: 'session_not_found' });
      } else if (err instanceof PendingMismatchError) {
        res.status(409).json({ error: 'pending_mismatch' });
      } else {
        throw err;
      }
    }
  });

  return router;
}
