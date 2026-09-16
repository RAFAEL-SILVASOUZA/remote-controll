import { Router } from 'express';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';
import { issueAgentToken, listAgentTokens, revokeAgentToken } from '../db/agentTokens.js';
import { requireWebAuthPage, requireWebAuthApi } from '../auth/webAuth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', '..', 'public');

export function createTokenRouter(db: DatabaseSync): Router {
  const router = Router();
  router.use(express.json());

  router.get('/tokens', requireWebAuthPage, (_req, res) => {
    res.sendFile(path.join(publicDir, 'tokens.html'));
  });

  router.get('/api/tokens', requireWebAuthApi, (req, res) => {
    res.json(listAgentTokens(db, req.userId!));
  });

  router.post('/api/tokens', requireWebAuthApi, (req, res) => {
    const label = typeof req.body?.label === 'string' && req.body.label.trim() ? req.body.label.trim() : 'vide-code';
    const { token, secret } = issueAgentToken(db, req.userId!, label);
    res.status(201).json({ ...token, secret });
  });

  router.delete('/api/tokens/:id', requireWebAuthApi, (req, res) => {
    const removed = revokeAgentToken(db, req.userId!, req.params.id as string);
    if (!removed) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.status(204).end();
  });

  return router;
}
