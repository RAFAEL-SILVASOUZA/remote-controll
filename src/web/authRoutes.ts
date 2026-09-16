import { Router } from 'express';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { DatabaseSync } from 'node:sqlite';
import { createUser, findUserByEmail, EmailAlreadyRegisteredError } from '../db/users.js';
import { createWebSession, deleteWebSession } from '../db/webSessions.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { setSessionCookie, clearSessionCookie, getSessionCookie } from '../auth/webAuth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', '..', 'public');

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  confirmPassword: z.string().min(8),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export function createAuthRouter(db: DatabaseSync): Router {
  const router = Router();
  router.use(express.json());

  router.get('/login', (_req, res) => {
    res.sendFile('login.html', { root: publicDir });
  });

  router.get('/signup', (_req, res) => {
    res.sendFile('signup.html', { root: publicDir });
  });

  router.post('/api/auth/signup', (req, res) => {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_input' });
      return;
    }
    const { email, password, confirmPassword } = parsed.data;
    if (password !== confirmPassword) {
      res.status(400).json({ error: 'password_mismatch' });
      return;
    }
    try {
      const user = createUser(db, email, hashPassword(password));
      const session = createWebSession(db, user.id);
      setSessionCookie(res, session.id);
      res.json({ ok: true, user: { id: user.id, email: user.email } });
    } catch (err) {
      if (err instanceof EmailAlreadyRegisteredError) {
        res.status(409).json({ error: 'email_taken' });
        return;
      }
      throw err;
    }
  });

  router.post('/api/auth/login', (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_input' });
      return;
    }
    const { email, password } = parsed.data;
    const user = findUserByEmail(db, email);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      res.status(401).json({ error: 'invalid_credentials' });
      return;
    }
    const session = createWebSession(db, user.id);
    setSessionCookie(res, session.id);
    res.json({ ok: true, user: { id: user.id, email: user.email } });
  });

  router.post('/api/auth/logout', (req, res) => {
    const sessionId = getSessionCookie(req);
    if (sessionId) deleteWebSession(db, sessionId);
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  return router;
}
