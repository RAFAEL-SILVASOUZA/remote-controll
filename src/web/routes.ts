import { Router } from 'express';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Response } from 'express';
import { AgentHub, ConversationNotFoundError, ConnectionUnavailableError } from '../agent/hub.js';
import type { Conversation } from '../agent/hub.js';
import { requireWebAuthPage, requireWebAuthApi } from '../auth/webAuth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', '..', 'public');

function toConversationJson(conversation: Conversation) {
  return {
    id: conversation.id,
    title: conversation.title,
    status: conversation.status,
    message: conversation.message,
    history: conversation.history,
    activity: conversation.activity,
    pendingQuestion: conversation.pendingQuestion,
    error: conversation.error,
  };
}

function setupSse(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
}

function handleCommandError(err: unknown, res: Response): void {
  if (err instanceof ConversationNotFoundError) {
    res.status(404).json({ error: 'conversation_not_found' });
  } else if (err instanceof ConnectionUnavailableError) {
    res.status(409).json({ error: 'connection_unavailable' });
  } else {
    throw err;
  }
}

export function createWebRouter(hub: AgentHub): Router {
  const router = Router();
  router.use(express.json());

  router.get('/', requireWebAuthPage, (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  router.get('/conversations/:id', requireWebAuthPage, (req, res) => {
    const conversation = hub.getConversation(req.params.id as string);
    if (!conversation || conversation.userId !== req.userId) {
      res.status(404).send('Conversa não encontrada.');
      return;
    }
    res.sendFile(path.join(publicDir, 'conversation.html'));
  });

  router.get('/api/conversations', requireWebAuthApi, (req, res) => {
    res.json(hub.listConversations(req.userId!).map(toConversationJson));
  });

  router.get('/events', requireWebAuthApi, (req, res) => {
    setupSse(res);
    const userId = req.userId!;
    const send = () => {
      res.write(`event: conversations\ndata: ${JSON.stringify(hub.listConversations(userId).map(toConversationJson))}\n\n`);
    };
    send();
    hub.on('conversations-changed', send);
    req.on('close', () => hub.off('conversations-changed', send));
  });

  router.get('/api/conversations/:id', requireWebAuthApi, (req, res) => {
    const conversation = hub.getConversation(req.params.id as string);
    if (!conversation || conversation.userId !== req.userId) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(toConversationJson(conversation));
  });

  router.get('/conversations/:id/events', requireWebAuthApi, (req, res) => {
    const id = req.params.id as string;
    const conversation = hub.getConversation(id);
    if (!conversation || conversation.userId !== req.userId) {
      res.status(404).end();
      return;
    }
    setupSse(res);
    const onUpdate = (updated: Conversation) => {
      if (updated.id !== id) return;
      res.write(`event: update\ndata: ${JSON.stringify(toConversationJson(updated))}\n\n`);
    };
    hub.on('conversation-updated', onUpdate);
    req.on('close', () => hub.off('conversation-updated', onUpdate));
  });

  router.post('/api/conversations/:id/message', requireWebAuthApi, (req, res) => {
    const id = req.params.id as string;
    const conversation = hub.getConversation(id);
    if (!conversation || conversation.userId !== req.userId) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!message) {
      res.status(400).json({ error: 'invalid_message' });
      return;
    }
    try {
      hub.sendCommand({ operation: 'send_message', payload: { id, message } });
      res.status(202).json({ ok: true });
    } catch (err) {
      handleCommandError(err, res);
    }
  });

  router.post('/api/conversations/:id/stop', requireWebAuthApi, (req, res) => {
    const id = req.params.id as string;
    const conversation = hub.getConversation(id);
    if (!conversation || conversation.userId !== req.userId) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    try {
      hub.sendCommand({ operation: 'stop_response', payload: { id } });
      res.status(202).json({ ok: true });
    } catch (err) {
      handleCommandError(err, res);
    }
  });

  router.post('/api/conversations/:id/answer', requireWebAuthApi, (req, res) => {
    const id = req.params.id as string;
    const conversation = hub.getConversation(id);
    if (!conversation || conversation.userId !== req.userId) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const pending = conversation.pendingQuestion;
    if (!pending) {
      res.status(409).json({ error: 'no_pending_question' });
      return;
    }
    const skipped = Boolean(req.body?.skipped);
    const answers = skipped ? undefined : (req.body?.answers as Record<string, string | string[]> | undefined);
    try {
      hub.sendCommand({ operation: 'answer_question', payload: { id, messageId: pending.messageId, answers, skipped } });
      res.status(202).json({ ok: true });
    } catch (err) {
      handleCommandError(err, res);
    }
  });

  return router;
}
