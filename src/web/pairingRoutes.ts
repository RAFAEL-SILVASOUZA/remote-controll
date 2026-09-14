import { Router } from 'express';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';
import {
  createPairing,
  getPairing,
  approvePairing,
  rejectPairing,
  isPairingExpired,
  PairingNotPendingError,
} from '../db/pairing.js';
import { requireWebAuthPage, requireWebAuthApi } from '../auth/webAuth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', '..', 'public');

export function createPairingRouter(db: DatabaseSync, publicBaseUrl: string): Router {
  const router = Router();
  router.use(express.json());

  router.post('/api/mcp/pairing/start', (req, res) => {
    const workspace = typeof req.body?.workspace === 'string' ? req.body.workspace : undefined;
    const pairing = createPairing(db, workspace);
    res.json({ code: pairing.code, verifyUrl: `${publicBaseUrl}/pair/${pairing.code}` });
  });

  router.get('/api/mcp/pairing/:code', (req, res) => {
    const pairing = getPairing(db, req.params.code);
    if (!pairing || isPairingExpired(pairing)) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    if (pairing.status === 'approved') {
      res.json({ status: 'approved', token: pairing.token, expiresAt: pairing.expiresAt });
      return;
    }
    res.json({ status: pairing.status });
  });

  router.get('/pair/:code', requireWebAuthPage, (req, res) => {
    const code = req.params.code as string;
    const pairing = getPairing(db, code);
    if (!pairing || isPairingExpired(pairing)) {
      res.status(404).send('Código de pareamento inválido ou expirado.');
      return;
    }
    res.sendFile(path.join(publicDir, 'pair.html'));
  });

  router.get('/api/pair/:code', requireWebAuthApi, (req, res) => {
    const code = req.params.code as string;
    const pairing = getPairing(db, code);
    if (!pairing || isPairingExpired(pairing)) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json({ code: pairing.code, status: pairing.status, workspace: pairing.workspace ?? null });
  });

  router.post('/api/pair/:code/approve', requireWebAuthApi, (req, res) => {
    const code = req.params.code as string;
    try {
      approvePairing(db, code, req.userId!);
      res.json({ ok: true });
    } catch (err) {
      if (err instanceof PairingNotPendingError) {
        res.status(409).json({ error: 'not_pending' });
        return;
      }
      throw err;
    }
  });

  router.post('/api/pair/:code/reject', requireWebAuthApi, (req, res) => {
    const code = req.params.code as string;
    try {
      rejectPairing(db, code);
      res.json({ ok: true });
    } catch (err) {
      if (err instanceof PairingNotPendingError) {
        res.status(409).json({ error: 'not_pending' });
        return;
      }
      throw err;
    }
  });

  return router;
}
