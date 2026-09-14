# Auth, Multiuser Sessions, Choice Tools & Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add e-mail/password accounts, a device-pairing flow so MCP agents authenticate without a human typing anything into them, per-user session ownership, `ask_human` radio/checkbox support, workspace tagging, and an "enterprise" visual redesign to the existing remote-controll MCP server.

**Architecture:** SQLite (`node:sqlite`, built into Node 24, no extra dependency) stores users, MCP bearer tokens, pairing requests and web sessions. Two independent auth channels share the same `users` table: a browser-session cookie (humans) and a long-lived Bearer token (MCP agents), obtained through a device-pairing flow that routes through the browser login. `SessionStore` (in-memory, from the previous plan) gains `userId`/`workspace` per session and per-user filtering.

**Tech Stack:** Node.js, TypeScript, Express, `node:sqlite`, `node:crypto` (scrypt for password hashing, no bcrypt dependency), `zod`, `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-14-auth-multiuser-design.md` (builds on `docs/superpowers/specs/2026-09-14-remote-mcp-design.md`)

## Global Constraints

- No new npm dependencies — `node:sqlite`, `node:crypto`, `express`, `zod` already cover everything needed.
- MCP bearer tokens: TTL 5 days. Web session cookies: no `Max-Age` (dies with the browser), plus a 24h hard server-side cap on the underlying `web_sessions` row.
- Password: `scrypt` + random salt, minimum 8 characters, `password === confirmPassword` enforced server-side regardless of client-side checks.
- E-mail: format validation only (`zod` `.email()`), no confirmation e-mail.
- Every file that touches the database receives a `DatabaseSync` instance as a parameter — no module-level singleton import inside `db/*.ts` files — so tests can pass an in-memory `:memory:` database.

---

## Task 1: Database layer + password hashing

**Files:**
- Create: `src/db/index.ts`
- Create: `src/db/users.ts`
- Create: `src/db/tokens.ts`
- Create: `src/db/pairing.ts`
- Create: `src/db/webSessions.ts`
- Create: `src/auth/password.ts`
- Test: `src/db/users.test.ts`
- Test: `src/db/tokens.test.ts`
- Test: `src/db/pairing.test.ts`
- Test: `src/db/webSessions.test.ts`
- Test: `src/auth/password.test.ts`
- Modify: `package.json` (`test` script)

**Interfaces:**
- Produces (used by Task 2 onward):
  - `createDb(dbPath: string): DatabaseSync` and `db: DatabaseSync` (default instance) from `src/db/index.ts`.
  - `createUser(db, email, passwordHash): User`, `findUserByEmail(db, email): User | undefined`, `findUserById(db, id): User | undefined`, `class EmailAlreadyRegisteredError` from `src/db/users.ts`. `User = { id, email, passwordHash, createdAt }`.
  - `createToken(db, userId): { token: string; expiresAt: string }`, `findUserIdByToken(db, token): string | undefined` from `src/db/tokens.ts`.
  - `createPairing(db, workspace?): PairingRequest`, `getPairing(db, code): PairingRequest | undefined`, `isPairingExpired(pairing): boolean`, `approvePairing(db, code, userId): PairingRequest`, `rejectPairing(db, code): PairingRequest`, `class PairingNotPendingError` from `src/db/pairing.ts`. `PairingRequest = { code, status: 'pending'|'approved'|'rejected', userId?, token?, workspace?, createdAt, expiresAt }`.
  - `createWebSession(db, userId): { id: string; expiresAt: string }`, `findUserIdByWebSession(db, id): string | undefined`, `deleteWebSession(db, id): void` from `src/db/webSessions.ts`.
  - `hashPassword(password): string`, `verifyPassword(password, stored): boolean` from `src/auth/password.ts`.

- [ ] **Step 1: Create `src/db/index.ts`**

```ts
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createDb(dbPath: string): DatabaseSync {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mcp_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pairing_requests (
      code TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      user_id TEXT,
      token TEXT,
      workspace TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS web_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
  `);
  return db;
}

const defaultDbPath = process.env.DB_PATH ?? path.join(__dirname, '..', '..', 'data.sqlite');
export const db = createDb(defaultDbPath);
```

- [ ] **Step 2: Create `src/db/users.ts`**

```ts
import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: string;
}

export class EmailAlreadyRegisteredError extends Error {
  constructor(email: string) {
    super(`E-mail já cadastrado: ${email}`);
  }
}

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  created_at: string;
}

function toUser(row: UserRow): User {
  return { id: row.id, email: row.email, passwordHash: row.password_hash, createdAt: row.created_at };
}

export function createUser(db: DatabaseSync, email: string, passwordHash: string): User {
  if (findUserByEmail(db, email)) throw new EmailAlreadyRegisteredError(email);
  const user: User = { id: randomUUID(), email, passwordHash, createdAt: new Date().toISOString() };
  db.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    user.id,
    user.email,
    user.passwordHash,
    user.createdAt,
  );
  return user;
}

export function findUserByEmail(db: DatabaseSync, email: string): User | undefined {
  const row = db.prepare('SELECT id, email, password_hash, created_at FROM users WHERE email = ?').get(email) as
    | UserRow
    | undefined;
  return row ? toUser(row) : undefined;
}

export function findUserById(db: DatabaseSync, id: string): User | undefined {
  const row = db.prepare('SELECT id, email, password_hash, created_at FROM users WHERE id = ?').get(id) as
    | UserRow
    | undefined;
  return row ? toUser(row) : undefined;
}
```

- [ ] **Step 3: Create `src/auth/password.ts`**

```ts
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const candidate = scryptSync(password, salt, expected.length);
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}
```

- [ ] **Step 4: Create `src/db/tokens.ts`**

```ts
import type { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash } from 'node:crypto';

const TOKEN_TTL_MS = 5 * 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createToken(db: DatabaseSync, userId: string): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString('hex');
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + TOKEN_TTL_MS);
  db.prepare('INSERT INTO mcp_tokens (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    hashToken(token),
    userId,
    createdAt.toISOString(),
    expiresAt.toISOString(),
  );
  return { token, expiresAt: expiresAt.toISOString() };
}

export function findUserIdByToken(db: DatabaseSync, token: string): string | undefined {
  const row = db.prepare('SELECT user_id, expires_at FROM mcp_tokens WHERE token_hash = ?').get(hashToken(token)) as
    | { user_id: string; expires_at: string }
    | undefined;
  if (!row) return undefined;
  if (new Date(row.expires_at).getTime() <= Date.now()) return undefined;
  return row.user_id;
}
```

- [ ] **Step 5: Create `src/db/pairing.ts`**

```ts
import type { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { createToken } from './tokens.js';

const PAIRING_TTL_MS = 10 * 60 * 1000;

export type PairingStatus = 'pending' | 'approved' | 'rejected';

export interface PairingRequest {
  code: string;
  status: PairingStatus;
  userId?: string;
  token?: string;
  workspace?: string;
  createdAt: string;
  expiresAt: string;
}

interface PairingRow {
  code: string;
  status: PairingStatus;
  user_id: string | null;
  token: string | null;
  workspace: string | null;
  created_at: string;
  expires_at: string;
}

function toPairing(row: PairingRow): PairingRequest {
  return {
    code: row.code,
    status: row.status,
    userId: row.user_id ?? undefined,
    token: row.token ?? undefined,
    workspace: row.workspace ?? undefined,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export class PairingNotPendingError extends Error {
  constructor(code: string) {
    super(`Pairing não está pendente: ${code}`);
  }
}

export function createPairing(db: DatabaseSync, workspace: string | undefined): PairingRequest {
  const code = randomBytes(16).toString('hex');
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + PAIRING_TTL_MS);
  db.prepare(
    'INSERT INTO pairing_requests (code, status, workspace, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
  ).run(code, 'pending', workspace ?? null, createdAt.toISOString(), expiresAt.toISOString());
  return {
    code,
    status: 'pending',
    workspace,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}

export function getPairing(db: DatabaseSync, code: string): PairingRequest | undefined {
  const row = db.prepare('SELECT * FROM pairing_requests WHERE code = ?').get(code) as PairingRow | undefined;
  return row ? toPairing(row) : undefined;
}

export function isPairingExpired(pairing: PairingRequest): boolean {
  return new Date(pairing.expiresAt).getTime() <= Date.now();
}

export function approvePairing(db: DatabaseSync, code: string, userId: string): PairingRequest {
  const pairing = getPairing(db, code);
  if (!pairing || pairing.status !== 'pending' || isPairingExpired(pairing)) {
    throw new PairingNotPendingError(code);
  }
  const { token } = createToken(db, userId);
  db.prepare('UPDATE pairing_requests SET status = ?, user_id = ?, token = ? WHERE code = ?').run(
    'approved',
    userId,
    token,
    code,
  );
  return { ...pairing, status: 'approved', userId, token };
}

export function rejectPairing(db: DatabaseSync, code: string): PairingRequest {
  const pairing = getPairing(db, code);
  if (!pairing || pairing.status !== 'pending' || isPairingExpired(pairing)) {
    throw new PairingNotPendingError(code);
  }
  db.prepare('UPDATE pairing_requests SET status = ? WHERE code = ?').run('rejected', code);
  return { ...pairing, status: 'rejected' };
}
```

- [ ] **Step 6: Create `src/db/webSessions.ts`**

```ts
import type { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';

const WEB_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export function createWebSession(db: DatabaseSync, userId: string): { id: string; expiresAt: string } {
  const id = randomBytes(32).toString('hex');
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + WEB_SESSION_TTL_MS);
  db.prepare('INSERT INTO web_sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    id,
    userId,
    createdAt.toISOString(),
    expiresAt.toISOString(),
  );
  return { id, expiresAt: expiresAt.toISOString() };
}

export function findUserIdByWebSession(db: DatabaseSync, id: string): string | undefined {
  const row = db.prepare('SELECT user_id, expires_at FROM web_sessions WHERE id = ?').get(id) as
    | { user_id: string; expires_at: string }
    | undefined;
  if (!row) return undefined;
  if (new Date(row.expires_at).getTime() <= Date.now()) return undefined;
  return row.user_id;
}

export function deleteWebSession(db: DatabaseSync, id: string): void {
  db.prepare('DELETE FROM web_sessions WHERE id = ?').run(id);
}
```

- [ ] **Step 7: Write the tests**

`src/auth/password.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from './password.js';

test('verifyPassword aceita a senha correta', () => {
  const stored = hashPassword('senha-correta-123');
  assert.equal(verifyPassword('senha-correta-123', stored), true);
});

test('verifyPassword rejeita senha errada', () => {
  const stored = hashPassword('senha-correta-123');
  assert.equal(verifyPassword('outra-senha', stored), false);
});
```

`src/db/users.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from './index.js';
import { createUser, findUserByEmail, findUserById, EmailAlreadyRegisteredError } from './users.js';

test('createUser + findUserByEmail + findUserById', () => {
  const db = createDb(':memory:');
  const user = createUser(db, 'ana@example.com', 'hash123');
  assert.equal(findUserByEmail(db, 'ana@example.com')?.id, user.id);
  assert.equal(findUserById(db, user.id)?.email, 'ana@example.com');
});

test('createUser rejeita e-mail duplicado', () => {
  const db = createDb(':memory:');
  createUser(db, 'ana@example.com', 'hash123');
  assert.throws(() => createUser(db, 'ana@example.com', 'outrahash'), EmailAlreadyRegisteredError);
});
```

`src/db/tokens.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createDb } from './index.js';
import { createUser } from './users.js';
import { createToken, findUserIdByToken } from './tokens.js';

test('createToken + findUserIdByToken', () => {
  const db = createDb(':memory:');
  const user = createUser(db, 'ana@example.com', 'hash123');
  const { token } = createToken(db, user.id);
  assert.equal(findUserIdByToken(db, token), user.id);
});

test('findUserIdByToken retorna undefined para token desconhecido', () => {
  const db = createDb(':memory:');
  assert.equal(findUserIdByToken(db, 'token-que-nao-existe'), undefined);
});

test('findUserIdByToken retorna undefined para token expirado', () => {
  const db = createDb(':memory:');
  const user = createUser(db, 'ana@example.com', 'hash123');
  const { token } = createToken(db, user.id);
  const tokenHash = createHash('sha256').update(token).digest('hex');
  db.prepare('UPDATE mcp_tokens SET expires_at = ? WHERE token_hash = ?').run(
    new Date(Date.now() - 1000).toISOString(),
    tokenHash,
  );
  assert.equal(findUserIdByToken(db, token), undefined);
});
```

`src/db/pairing.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from './index.js';
import { createUser } from './users.js';
import { createPairing, getPairing, approvePairing, rejectPairing, PairingNotPendingError } from './pairing.js';
import { findUserIdByToken } from './tokens.js';

test('createPairing + getPairing', () => {
  const db = createDb(':memory:');
  const pairing = createPairing(db, 'D:/projetos/x');
  assert.equal(getPairing(db, pairing.code)?.status, 'pending');
  assert.equal(getPairing(db, pairing.code)?.workspace, 'D:/projetos/x');
});

test('approvePairing gera um token válido para o usuário', () => {
  const db = createDb(':memory:');
  const user = createUser(db, 'ana@example.com', 'hash123');
  const pairing = createPairing(db, undefined);
  const approved = approvePairing(db, pairing.code, user.id);
  assert.equal(approved.status, 'approved');
  assert.ok(approved.token);
  assert.equal(findUserIdByToken(db, approved.token!), user.id);
});

test('approvePairing rejeita pairing que não está pendente', () => {
  const db = createDb(':memory:');
  const user = createUser(db, 'ana@example.com', 'hash123');
  const pairing = createPairing(db, undefined);
  approvePairing(db, pairing.code, user.id);
  assert.throws(() => approvePairing(db, pairing.code, user.id), PairingNotPendingError);
});

test('rejectPairing marca como rejeitado', () => {
  const db = createDb(':memory:');
  const pairing = createPairing(db, undefined);
  const rejected = rejectPairing(db, pairing.code);
  assert.equal(rejected.status, 'rejected');
});
```

`src/db/webSessions.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from './index.js';
import { createUser } from './users.js';
import { createWebSession, findUserIdByWebSession, deleteWebSession } from './webSessions.js';

test('createWebSession + findUserIdByWebSession', () => {
  const db = createDb(':memory:');
  const user = createUser(db, 'ana@example.com', 'hash123');
  const session = createWebSession(db, user.id);
  assert.equal(findUserIdByWebSession(db, session.id), user.id);
});

test('deleteWebSession invalida a sessão', () => {
  const db = createDb(':memory:');
  const user = createUser(db, 'ana@example.com', 'hash123');
  const session = createWebSession(db, user.id);
  deleteWebSession(db, session.id);
  assert.equal(findUserIdByWebSession(db, session.id), undefined);
});
```

- [ ] **Step 8: Update the `test` script in `package.json`**

Replace the `"test"` script with:

```json
"test": "tsx --test src/sessions/store.test.ts src/auth/password.test.ts src/db/users.test.ts src/db/tokens.test.ts src/db/pairing.test.ts src/db/webSessions.test.ts",
```

- [ ] **Step 9: Run the tests**

Run: `npm test`
Expected: PASS — all tests green (4 from `store.test.ts` plus the new ones from this task).

- [ ] **Step 10: Commit**

```bash
git add src/db src/auth/password.ts src/auth/password.test.ts package.json
git commit -m "feat: add SQLite-backed users, tokens, pairing and web sessions"
```

---

## Task 2: Web authentication (signup/login/logout)

**Files:**
- Create: `src/auth/webAuth.ts`
- Create: `src/web/authRoutes.ts`
- Create: `public/login.html`
- Create: `public/login.js`
- Create: `public/signup.html`
- Create: `public/signup.js`
- Modify: `src/server.ts`

**Interfaces:**
- Consumes: `db` from `src/db/index.ts`; `createUser`, `findUserByEmail`, `EmailAlreadyRegisteredError` from `src/db/users.ts`; `createWebSession`, `deleteWebSession` from `src/db/webSessions.ts`; `hashPassword`, `verifyPassword` from `src/auth/password.ts`.
- Produces (used by later tasks): `getSessionCookie(req)`, `setSessionCookie(res, id)`, `clearSessionCookie(res)`, `attachUser(db)`, `requireWebAuthPage`, `requireWebAuthApi` from `src/auth/webAuth.ts`; module augmentation adding `req.userId?: string` and `req.workspace?: string`. `createAuthRouter(db): Router` from `src/web/authRoutes.ts`.

- [ ] **Step 1: Create `src/auth/webAuth.ts`**

```ts
import type { Request, Response, NextFunction } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { findUserIdByWebSession } from '../db/webSessions.js';

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      workspace?: string;
    }
  }
}

const COOKIE_NAME = 'session';

function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

export function getSessionCookie(req: Request): string | undefined {
  return parseCookies(req.headers.cookie)[COOKIE_NAME];
}

export function setSessionCookie(res: Response, sessionId: string): void {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${sessionId}; HttpOnly; Secure; SameSite=Lax; Path=/`);
}

export function clearSessionCookie(res: Response): void {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
}

export function attachUser(db: DatabaseSync) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const sessionId = getSessionCookie(req);
    if (sessionId) {
      req.userId = findUserIdByWebSession(db, sessionId);
    }
    next();
  };
}

export function requireWebAuthPage(req: Request, res: Response, next: NextFunction): void {
  if (!req.userId) {
    res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    return;
  }
  next();
}

export function requireWebAuthApi(req: Request, res: Response, next: NextFunction): void {
  if (!req.userId) {
    res.status(401).json({ error: 'authentication_required' });
    return;
  }
  next();
}
```

- [ ] **Step 2: Create `src/web/authRoutes.ts`**

```ts
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
    res.sendFile(path.join(publicDir, 'login.html'));
  });

  router.get('/signup', (_req, res) => {
    res.sendFile(path.join(publicDir, 'signup.html'));
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
```

- [ ] **Step 3: Create `public/login.html`**

```html
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>remote-controll — Entrar</title>
  <link rel="stylesheet" href="/style.css" />
</head>
<body class="auth-page">
  <form id="login-form" class="auth-card">
    <h1>Entrar</h1>
    <label>E-mail<input type="email" id="email" required /></label>
    <label>Senha<input type="password" id="password" required /></label>
    <button type="submit">Entrar</button>
    <p id="error" class="error" hidden></p>
    <p class="auth-switch">Não tem conta? <a href="/signup">Cadastre-se</a></p>
  </form>
  <script src="/login.js"></script>
</body>
</html>
```

- [ ] **Step 4: Create `public/login.js`**

```js
const form = document.getElementById('login-form');
const errorEl = document.getElementById('error');

function nextUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('next') || '/';
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorEl.hidden = true;
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (res.ok) {
    window.location.href = nextUrl();
    return;
  }
  errorEl.textContent = 'E-mail ou senha inválidos.';
  errorEl.hidden = false;
});
```

- [ ] **Step 5: Create `public/signup.html`**

```html
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>remote-controll — Cadastro</title>
  <link rel="stylesheet" href="/style.css" />
</head>
<body class="auth-page">
  <form id="signup-form" class="auth-card">
    <h1>Criar conta</h1>
    <label>E-mail<input type="email" id="email" required /></label>
    <label>Senha<input type="password" id="password" minlength="8" required /></label>
    <label>Confirmar senha<input type="password" id="confirmPassword" minlength="8" required /></label>
    <button type="submit">Cadastrar</button>
    <p id="error" class="error" hidden></p>
    <p class="auth-switch">Já tem conta? <a href="/login">Entrar</a></p>
  </form>
  <script src="/signup.js"></script>
</body>
</html>
```

- [ ] **Step 6: Create `public/signup.js`**

```js
const form = document.getElementById('signup-form');
const errorEl = document.getElementById('error');

const ERROR_MESSAGES = {
  email_taken: 'Este e-mail já está cadastrado.',
  password_mismatch: 'As senhas não coincidem.',
  invalid_input: 'Verifique os campos preenchidos.',
};

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorEl.hidden = true;
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const confirmPassword = document.getElementById('confirmPassword').value;

  if (password !== confirmPassword) {
    errorEl.textContent = ERROR_MESSAGES.password_mismatch;
    errorEl.hidden = false;
    return;
  }

  const res = await fetch('/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, confirmPassword }),
  });
  if (res.ok) {
    window.location.href = '/';
    return;
  }
  const body = await res.json().catch(() => ({}));
  errorEl.textContent = ERROR_MESSAGES[body.error] ?? 'Não foi possível cadastrar.';
  errorEl.hidden = false;
});
```

- [ ] **Step 7: Update `src/server.ts`**

Replace the full contents with:

```ts
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db/index.js';
import { attachUser } from './auth/webAuth.js';
import { createAuthRouter } from './web/authRoutes.js';
import { SessionStore } from './sessions/store.js';
import { createMcpRouter } from './mcp/server.js';
import { createWebRouter } from './web/routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const store = new SessionStore();
const app = express();

app.use(attachUser(db));
app.use(createAuthRouter(db));
app.use('/mcp', createMcpRouter(store));
app.use(createWebRouter(store));
app.use(express.static(path.join(__dirname, '..', 'public')));

const port = Number(process.env.PORT) || 5002;
app.listen(port, () => {
  console.log(`remote-controll MCP ouvindo em http://localhost:${port}`);
});
```

Note: `createMcpRouter(store)` and `createWebRouter(store)` keep their current (Task-1-plan) signatures for now — Tasks 3/4/6 of this plan will update these call sites again.

- [ ] **Step 8: Verify signup/login/logout manually**

Run `npm run dev`. In another terminal:

```bash
curl -i -c "$TEMP/cookies.txt" -X POST http://localhost:5002/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"ana@example.com","password":"senha1234","confirmPassword":"senha1234"}'
```
Expected: `200`, a `Set-Cookie: session=...` header, and `{"ok":true,...}` body.

```bash
curl -i -X POST http://localhost:5002/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"ana@example.com","password":"senha1234","confirmPassword":"senha1234"}'
```
Expected: `409` (e-mail já cadastrado).

```bash
curl -i -b "$TEMP/cookies.txt" -X POST http://localhost:5002/api/auth/logout
```
Expected: `200`.

```bash
curl -i -X POST http://localhost:5002/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"ana@example.com","password":"senha1234"}'
```
Expected: `200`, new `Set-Cookie`.

Stop the dev server after verifying.

- [ ] **Step 9: Commit**

```bash
git add src/auth/webAuth.ts src/web/authRoutes.ts public/login.html public/login.js public/signup.html public/signup.js src/server.ts
git commit -m "feat: add e-mail/password signup, login and logout"
```

---

## Task 3: SessionStore ownership (userId + workspace)

**Files:**
- Modify: `src/sessions/store.ts`
- Modify: `src/sessions/store.test.ts`

**Interfaces:**
- Produces (used by Task 4 onward): `createSession(id, clientName, userId, workspace): Session` (signature change — now requires `userId`/`workspace`); `listSessions(userId: string): SessionSummary[]` (signature change — now requires `userId`, filters by it); `Session`/`SessionSummary` gain `userId: string` and `workspace: string`.

- [ ] **Step 1: Update `src/sessions/store.ts`**

Replace the full contents with:

```ts
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

export type Role = 'agent' | 'human' | 'system';
export type MessageKind = 'question' | 'confirm' | 'answer' | 'info';

export interface Message {
  id: string;
  role: Role;
  kind: MessageKind;
  text: string;
  createdAt: string;
}

export type SessionStatus = 'idle' | 'waiting' | 'disconnected';
export type PendingKind = 'ask_human' | 'confirm_action';

export interface AskHumanAnswer {
  text: string;
}

export interface ConfirmActionAnswer {
  approved: boolean;
  comment?: string;
}

export type PendingAnswer = AskHumanAnswer | ConfirmActionAnswer;

export interface PendingRequest {
  id: string;
  kind: PendingKind;
  resolve: (answer: PendingAnswer) => void;
  reject: (err: Error) => void;
}

export interface SessionSummary {
  id: string;
  clientName: string;
  userId: string;
  workspace: string;
  connectedAt: string;
  status: SessionStatus;
}

export interface Session extends SessionSummary {
  messages: Message[];
  pending?: PendingRequest;
}

export class SessionNotFoundError extends Error {
  constructor(sessionId: string) {
    super(`Sessão não encontrada: ${sessionId}`);
  }
}

export class PendingMismatchError extends Error {
  constructor(sessionId: string, requestId: string) {
    super(`Pending request não corresponde: sessão=${sessionId} requestId=${requestId}`);
  }
}

export class SessionStore extends EventEmitter {
  private sessions = new Map<string, Session>();

  createSession(id: string, clientName: string, userId: string, workspace: string): Session {
    const session: Session = {
      id,
      clientName,
      userId,
      workspace,
      connectedAt: new Date().toISOString(),
      status: 'idle',
      messages: [],
    };
    this.sessions.set(id, session);
    this.emitSessionsChanged();
    return session;
  }

  removeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (session.pending) {
      session.pending.reject(new Error('Sessão desconectada antes de receber resposta.'));
      session.pending = undefined;
    }
    session.status = 'disconnected';
    this.addMessage(sessionId, 'system', 'info', 'Agente desconectado.');
    this.emitSessionsChanged();
  }

  listSessions(userId: string): SessionSummary[] {
    return [...this.sessions.values()]
      .filter((s) => s.userId === userId)
      .map(({ id, clientName, userId: uid, workspace, connectedAt, status }) => ({
        id,
        clientName,
        userId: uid,
        workspace,
        connectedAt,
        status,
      }));
  }

  getSession(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  addMessage(sessionId: string, role: Role, kind: MessageKind, text: string): Message {
    const session = this.sessions.get(sessionId);
    if (!session) throw new SessionNotFoundError(sessionId);
    const message: Message = {
      id: randomUUID(),
      role,
      kind,
      text,
      createdAt: new Date().toISOString(),
    };
    session.messages.push(message);
    this.emit('session-message', { sessionId, message });
    return message;
  }

  createPendingRequest(sessionId: string, kind: PendingKind, text: string): Promise<PendingAnswer> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new SessionNotFoundError(sessionId);
    this.addMessage(sessionId, 'agent', kind === 'ask_human' ? 'question' : 'confirm', text);
    session.status = 'waiting';
    this.emitSessionsChanged();
    return new Promise<PendingAnswer>((resolve, reject) => {
      session.pending = { id: randomUUID(), kind, resolve, reject };
    });
  }

  resolvePendingRequest(sessionId: string, requestId: string, answer: PendingAnswer): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new SessionNotFoundError(sessionId);
    if (!session.pending || session.pending.id !== requestId) {
      throw new PendingMismatchError(sessionId, requestId);
    }
    const pending = session.pending;
    session.pending = undefined;
    session.status = 'idle';
    const text =
      pending.kind === 'ask_human'
        ? (answer as AskHumanAnswer).text
        : (answer as ConfirmActionAnswer).approved
          ? `Aprovado.${(answer as ConfirmActionAnswer).comment ? ` Comentário: ${(answer as ConfirmActionAnswer).comment}` : ''}`
          : `Rejeitado.${(answer as ConfirmActionAnswer).comment ? ` Motivo: ${(answer as ConfirmActionAnswer).comment}` : ''}`;
    this.addMessage(sessionId, 'human', 'answer', text);
    pending.resolve(answer);
    this.emitSessionsChanged();
  }

  private emitSessionsChanged(): void {
    this.emit('sessions-changed');
  }
}
```

Note: `emitSessionsChanged` no longer sends a payload — Task 6 will make every listener re-fetch `listSessions(userId)` itself (each listener knows its own `userId`, the store doesn't).

- [ ] **Step 2: Update `src/sessions/store.test.ts`**

Replace the full contents with:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionStore, PendingMismatchError, SessionNotFoundError } from './store.js';

test('createPendingRequest resolves via resolvePendingRequest with matching requestId', async () => {
  const store = new SessionStore();
  store.createSession('s1', 'Agente Teste', 'user-1', 'D:/ws');

  const pendingPromise = store.createPendingRequest('s1', 'ask_human', 'Qual é a cor do céu?');
  const session = store.getSession('s1');
  assert.ok(session?.pending);
  const requestId = session!.pending!.id;

  store.resolvePendingRequest('s1', requestId, { text: 'Azul' });

  const answer = await pendingPromise;
  assert.deepEqual(answer, { text: 'Azul' });
  assert.equal(store.getSession('s1')?.status, 'idle');
});

test('resolvePendingRequest rejeita requestId que não é o pendente atual', () => {
  const store = new SessionStore();
  store.createSession('s2', 'Agente Teste', 'user-1', 'D:/ws');
  store.createPendingRequest('s2', 'ask_human', 'Pergunta');

  assert.throws(() => store.resolvePendingRequest('s2', 'id-errado', { text: 'x' }), PendingMismatchError);
});

test('resolvePendingRequest rejeita sessão inexistente', () => {
  const store = new SessionStore();
  assert.throws(() => store.resolvePendingRequest('nao-existe', 'qualquer', { text: 'x' }), SessionNotFoundError);
});

test('removeSession rejeita a pending request em aberto', async () => {
  const store = new SessionStore();
  store.createSession('s3', 'Agente Teste', 'user-1', 'D:/ws');
  const pendingPromise = store.createPendingRequest('s3', 'confirm_action', 'Confirma?');

  store.removeSession('s3');

  await assert.rejects(pendingPromise, /desconectada/);
  assert.equal(store.getSession('s3')?.status, 'disconnected');
});

test('listSessions só retorna sessões do userId informado', () => {
  const store = new SessionStore();
  store.createSession('sa', 'Agente A', 'user-1', 'D:/ws-a');
  store.createSession('sb', 'Agente B', 'user-2', 'D:/ws-b');

  const forUser1 = store.listSessions('user-1');
  assert.equal(forUser1.length, 1);
  assert.equal(forUser1[0].id, 'sa');
  assert.equal(forUser1[0].workspace, 'D:/ws-a');
});
```

- [ ] **Step 3: Run the tests**

Run: `npm test`
Expected: FAIL at this point — `src/mcp/server.ts` still calls the old 2-argument `createSession`/`listSessions` signatures, so `npm run dev`/anything importing it would break, but the pure `store.test.ts` unit tests themselves should PASS since they only exercise `store.ts` directly. Confirm: PASS for all `store.test.ts` cases (this task doesn't touch `mcp/server.ts` or `web/routes.ts` — those are fixed in Tasks 4 and 6, which is expected and fine; this task is about the store in isolation).

- [ ] **Step 4: Commit**

```bash
git add src/sessions/store.ts src/sessions/store.test.ts
git commit -m "feat: scope SessionStore sessions by userId and add workspace"
```

---

## Task 4: MCP device-pairing flow

**Files:**
- Create: `src/auth/mcpAuth.ts`
- Create: `src/web/pairingRoutes.ts`
- Create: `public/pair.html`
- Create: `public/pair.js`
- Modify: `src/mcp/server.ts`
- Modify: `src/server.ts`

**Interfaces:**
- Consumes: `db` from `src/db/index.ts`; `findUserIdByToken` from `src/db/tokens.ts`; `createPairing`, `getPairing`, `approvePairing`, `rejectPairing`, `isPairingExpired`, `PairingNotPendingError` from `src/db/pairing.ts`; `requireWebAuthPage`, `requireWebAuthApi` from `src/auth/webAuth.ts`; `SessionStore#createSession(id, clientName, userId, workspace)` from Task 3.
- Produces (used by Task 6): `requireMcpAuth(db)` middleware from `src/auth/mcpAuth.ts` (sets `req.userId`/`req.workspace`); `createPairingRouter(db, publicBaseUrl): Router` from `src/web/pairingRoutes.ts`.

- [ ] **Step 1: Create `src/auth/mcpAuth.ts`**

```ts
import type { Request, Response, NextFunction } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { findUserIdByToken } from '../db/tokens.js';

function extractBearerToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return undefined;
  return header.slice('Bearer '.length).trim();
}

export function requireMcpAuth(db: DatabaseSync) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const token = extractBearerToken(req);
    const userId = token ? findUserIdByToken(db, token) : undefined;
    if (!userId) {
      res.status(401).json({ error: 'authentication_required', pairingStartUrl: '/api/mcp/pairing/start' });
      return;
    }
    req.userId = userId;
    req.workspace = typeof req.headers['x-workspace'] === 'string' ? req.headers['x-workspace'] : 'Desconhecido';
    next();
  };
}
```

- [ ] **Step 2: Create `src/web/pairingRoutes.ts`**

```ts
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
    const pairing = getPairing(db, req.params.code);
    if (!pairing || isPairingExpired(pairing)) {
      res.status(404).send('Código de pareamento inválido ou expirado.');
      return;
    }
    res.sendFile(path.join(publicDir, 'pair.html'));
  });

  router.get('/api/pair/:code', requireWebAuthApi, (req, res) => {
    const pairing = getPairing(db, req.params.code);
    if (!pairing || isPairingExpired(pairing)) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json({ code: pairing.code, status: pairing.status, workspace: pairing.workspace ?? null });
  });

  router.post('/api/pair/:code/approve', requireWebAuthApi, (req, res) => {
    try {
      approvePairing(db, req.params.code, req.userId!);
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
    try {
      rejectPairing(db, req.params.code);
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
```

- [ ] **Step 3: Create `public/pair.html`**

```html
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>remote-controll — Parear agente</title>
  <link rel="stylesheet" href="/style.css" />
</head>
<body class="auth-page">
  <div class="auth-card">
    <h1>Novo agente</h1>
    <p id="workspace"></p>
    <div id="actions">
      <button id="approve">Aprovar</button>
      <button id="reject" class="secondary">Rejeitar</button>
    </div>
    <p id="result" hidden></p>
  </div>
  <script src="/pair.js"></script>
</body>
</html>
```

- [ ] **Step 4: Create `public/pair.js`**

```js
const code = window.location.pathname.split('/').pop();
const workspaceEl = document.getElementById('workspace');
const actionsEl = document.getElementById('actions');
const resultEl = document.getElementById('result');

async function load() {
  const res = await fetch(`/api/pair/${code}`);
  if (!res.ok) {
    workspaceEl.textContent = 'Este pareamento não existe mais ou expirou.';
    actionsEl.hidden = true;
    return;
  }
  const pairing = await res.json();
  workspaceEl.textContent = `Workspace: ${pairing.workspace ?? 'desconhecido'}`;
  if (pairing.status !== 'pending') {
    actionsEl.hidden = true;
    resultEl.textContent = pairing.status === 'approved' ? 'Já aprovado.' : 'Já rejeitado.';
    resultEl.hidden = false;
  }
}

async function respond(action) {
  const res = await fetch(`/api/pair/${code}/${action}`, { method: 'POST' });
  actionsEl.hidden = true;
  resultEl.textContent = res.ok
    ? action === 'approve'
      ? 'Agente aprovado! Pode voltar pro terminal.'
      : 'Agente rejeitado.'
    : 'Não foi possível concluir — tente recarregar a página.';
  resultEl.hidden = false;
}

document.getElementById('approve').onclick = () => respond('approve');
document.getElementById('reject').onclick = () => respond('reject');

load();
```

- [ ] **Step 5: Update `src/mcp/server.ts`**

Replace the full contents with:

```ts
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

export function createMcpRouter(store: SessionStore, db: DatabaseSync): Router {
  const router = Router();
  router.use(express.json());
  router.use(requireMcpAuth(db));

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
    await transport.handleRequest(req, res);
  };

  router.get('/', handleSessionRequest);
  router.delete('/', handleSessionRequest);

  return router;
}
```

- [ ] **Step 6: Update `src/server.ts`**

Replace the full contents with:

```ts
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db/index.js';
import { attachUser } from './auth/webAuth.js';
import { createAuthRouter } from './web/authRoutes.js';
import { createPairingRouter } from './web/pairingRoutes.js';
import { SessionStore } from './sessions/store.js';
import { createMcpRouter } from './mcp/server.js';
import { createWebRouter } from './web/routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const store = new SessionStore();
const app = express();
const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? 'http://localhost:5002';

app.use(attachUser(db));
app.use(createAuthRouter(db));
app.use(createPairingRouter(db, publicBaseUrl));
app.use('/mcp', createMcpRouter(store, db));
app.use(createWebRouter(store));
app.use(express.static(path.join(__dirname, '..', 'public')));

const port = Number(process.env.PORT) || 5002;
app.listen(port, () => {
  console.log(`remote-controll MCP ouvindo em http://localhost:${port}`);
});
```

Note: set `PUBLIC_BASE_URL=https://remote.rafael-silva-souza.dev` in the real environment (the running `npm run dev` process) so `verifyUrl` points at the public tunnel URL instead of `localhost`.

- [ ] **Step 7: Verify the pairing flow manually**

Run `PUBLIC_BASE_URL=http://localhost:5002 npm run dev` (or just `npm run dev` for a pure localhost test).

```bash
curl -s -X POST http://localhost:5002/api/mcp/pairing/start \
  -H "Content-Type: application/json" -d '{"workspace":"D:/teste"}'
```
Expected: `{"code":"...","verifyUrl":"http://localhost:5002/pair/..."}`.

```bash
curl -s http://localhost:5002/api/mcp/pairing/<code>
```
Expected: `{"status":"pending"}`.

Using the cookie jar from Task 2 (or sign up again):
```bash
curl -s -b "$TEMP/cookies.txt" -X POST http://localhost:5002/api/pair/<code>/approve
```
Expected: `{"ok":true}`.

```bash
curl -s http://localhost:5002/api/mcp/pairing/<code>
```
Expected: `{"status":"approved","token":"...","expiresAt":"..."}`.

```bash
curl -s http://localhost:5002/mcp \
  -H "Authorization: Bearer <token>" -H "X-Workspace: D:/teste" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl-test","version":"0.0.0"}},"id":1}'
```
Expected: a successful JSON-RPC response (not a `401`).

```bash
curl -s http://localhost:5002/mcp
```
(no Authorization header) Expected: `401` with `{"error":"authentication_required",...}`.

Stop the dev server after verifying.

- [ ] **Step 8: Commit**

```bash
git add src/auth/mcpAuth.ts src/web/pairingRoutes.ts public/pair.html public/pair.js src/mcp/server.ts src/server.ts
git commit -m "feat: add MCP device-pairing flow with bearer token auth"
```

---

## Task 5: `ask_human` radio/checkbox support

**Files:**
- Modify: `src/sessions/store.ts`
- Modify: `src/sessions/store.test.ts`
- Modify: `src/mcp/server.ts`
- Modify: `src/web/routes.ts`
- Modify: `public/chat.js`

**Interfaces:**
- Produces (used by Task 6): `Message`/`PendingRequest` gain `options?: string[]` and `multiple?: boolean`; `createPendingRequest(sessionId, kind, text, choice?: { options?: string[]; multiple?: boolean }): Promise<PendingAnswer>` (signature change — 4th param added, optional); `class InvalidAnswerError extends Error` from `src/sessions/store.ts`.

- [ ] **Step 1: Update `src/sessions/store.ts`**

Add `options`/`multiple` to `Message` and `PendingRequest`, change `createPendingRequest`'s signature, and validate answers against offered options in `resolvePendingRequest`. Replace the full contents with:

```ts
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

export type Role = 'agent' | 'human' | 'system';
export type MessageKind = 'question' | 'confirm' | 'answer' | 'info';

export interface Message {
  id: string;
  role: Role;
  kind: MessageKind;
  text: string;
  createdAt: string;
  options?: string[];
  multiple?: boolean;
}

export type SessionStatus = 'idle' | 'waiting' | 'disconnected';
export type PendingKind = 'ask_human' | 'confirm_action';

export interface AskHumanAnswer {
  text: string;
}

export interface ConfirmActionAnswer {
  approved: boolean;
  comment?: string;
}

export type PendingAnswer = AskHumanAnswer | ConfirmActionAnswer;

export interface PendingChoice {
  options?: string[];
  multiple?: boolean;
}

export interface PendingRequest extends PendingChoice {
  id: string;
  kind: PendingKind;
  resolve: (answer: PendingAnswer) => void;
  reject: (err: Error) => void;
}

export interface SessionSummary {
  id: string;
  clientName: string;
  userId: string;
  workspace: string;
  connectedAt: string;
  status: SessionStatus;
}

export interface Session extends SessionSummary {
  messages: Message[];
  pending?: PendingRequest;
}

export class SessionNotFoundError extends Error {
  constructor(sessionId: string) {
    super(`Sessão não encontrada: ${sessionId}`);
  }
}

export class PendingMismatchError extends Error {
  constructor(sessionId: string, requestId: string) {
    super(`Pending request não corresponde: sessão=${sessionId} requestId=${requestId}`);
  }
}

export class InvalidAnswerError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export class SessionStore extends EventEmitter {
  private sessions = new Map<string, Session>();

  createSession(id: string, clientName: string, userId: string, workspace: string): Session {
    const session: Session = {
      id,
      clientName,
      userId,
      workspace,
      connectedAt: new Date().toISOString(),
      status: 'idle',
      messages: [],
    };
    this.sessions.set(id, session);
    this.emitSessionsChanged();
    return session;
  }

  removeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (session.pending) {
      session.pending.reject(new Error('Sessão desconectada antes de receber resposta.'));
      session.pending = undefined;
    }
    session.status = 'disconnected';
    this.addMessage(sessionId, 'system', 'info', 'Agente desconectado.');
    this.emitSessionsChanged();
  }

  listSessions(userId: string): SessionSummary[] {
    return [...this.sessions.values()]
      .filter((s) => s.userId === userId)
      .map(({ id, clientName, userId: uid, workspace, connectedAt, status }) => ({
        id,
        clientName,
        userId: uid,
        workspace,
        connectedAt,
        status,
      }));
  }

  getSession(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  addMessage(
    sessionId: string,
    role: Role,
    kind: MessageKind,
    text: string,
    choice?: PendingChoice,
  ): Message {
    const session = this.sessions.get(sessionId);
    if (!session) throw new SessionNotFoundError(sessionId);
    const message: Message = {
      id: randomUUID(),
      role,
      kind,
      text,
      createdAt: new Date().toISOString(),
      options: choice?.options,
      multiple: choice?.multiple,
    };
    session.messages.push(message);
    this.emit('session-message', { sessionId, message });
    return message;
  }

  createPendingRequest(
    sessionId: string,
    kind: PendingKind,
    text: string,
    choice?: PendingChoice,
  ): Promise<PendingAnswer> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new SessionNotFoundError(sessionId);
    this.addMessage(sessionId, 'agent', kind === 'ask_human' ? 'question' : 'confirm', text, choice);
    session.status = 'waiting';
    this.emitSessionsChanged();
    return new Promise<PendingAnswer>((resolve, reject) => {
      session.pending = {
        id: randomUUID(),
        kind,
        options: choice?.options,
        multiple: choice?.multiple,
        resolve,
        reject,
      };
    });
  }

  resolvePendingRequest(sessionId: string, requestId: string, answer: PendingAnswer): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new SessionNotFoundError(sessionId);
    if (!session.pending || session.pending.id !== requestId) {
      throw new PendingMismatchError(sessionId, requestId);
    }
    const pending = session.pending;

    if (pending.kind === 'ask_human' && pending.options && pending.options.length > 0) {
      const text = (answer as AskHumanAnswer).text;
      const chosen = pending.multiple ? text.split(',').map((s) => s.trim()) : [text];
      const invalid = chosen.some((value) => !pending.options!.includes(value));
      if (chosen.length === 0 || invalid) {
        throw new InvalidAnswerError('Resposta não corresponde às opções oferecidas.');
      }
    }

    session.pending = undefined;
    session.status = 'idle';
    const text =
      pending.kind === 'ask_human'
        ? (answer as AskHumanAnswer).text
        : (answer as ConfirmActionAnswer).approved
          ? `Aprovado.${(answer as ConfirmActionAnswer).comment ? ` Comentário: ${(answer as ConfirmActionAnswer).comment}` : ''}`
          : `Rejeitado.${(answer as ConfirmActionAnswer).comment ? ` Motivo: ${(answer as ConfirmActionAnswer).comment}` : ''}`;
    this.addMessage(sessionId, 'human', 'answer', text);
    pending.resolve(answer);
    this.emitSessionsChanged();
  }

  private emitSessionsChanged(): void {
    this.emit('sessions-changed');
  }
}
```

- [ ] **Step 2: Add test cases to `src/sessions/store.test.ts`**

Add these two `test(...)` blocks to the end of the file (keep everything already there from Task 3):

```ts
test('resolvePendingRequest valida resposta de escolha única', async () => {
  const store = new SessionStore();
  store.createSession('s4', 'Agente Teste', 'user-1', 'D:/ws');
  const pendingPromise = store.createPendingRequest('s4', 'ask_human', 'Qual cor?', {
    options: ['Vermelho', 'Azul'],
  });
  const requestId = store.getSession('s4')!.pending!.id;

  assert.throws(() => store.resolvePendingRequest('s4', requestId, { text: 'Verde' }), InvalidAnswerError);

  store.resolvePendingRequest('s4', requestId, { text: 'Azul' });
  assert.deepEqual(await pendingPromise, { text: 'Azul' });
});

test('resolvePendingRequest valida resposta de escolha múltipla', async () => {
  const store = new SessionStore();
  store.createSession('s5', 'Agente Teste', 'user-1', 'D:/ws');
  const pendingPromise = store.createPendingRequest('s5', 'ask_human', 'Quais frutas?', {
    options: ['Maçã', 'Banana', 'Uva'],
    multiple: true,
  });
  const requestId = store.getSession('s5')!.pending!.id;

  store.resolvePendingRequest('s5', requestId, { text: 'Maçã, Uva' });
  assert.deepEqual(await pendingPromise, { text: 'Maçã, Uva' });
});
```

Also update the `import` line at the top to include `InvalidAnswerError`:

```ts
import { SessionStore, PendingMismatchError, SessionNotFoundError, InvalidAnswerError } from './store.js';
```

- [ ] **Step 3: Run the tests**

Run: `npm test`
Expected: PASS — all `store.test.ts` cases green (this task doesn't touch `mcp/server.ts`'s compile-worthiness in a way that affects `npm test`, since tests only import `store.ts` directly).

- [ ] **Step 4: Update the `ask_human` tool in `src/mcp/server.ts`**

In `buildMcpServer`, replace the `ask_human` tool registration with:

```ts
  server.tool(
    'ask_human',
    'Pergunta algo ao humano responsável. Texto livre por padrão; se "options" for informado, o humano escolhe entre elas (uma única, ou várias se "multiple" for true).',
    {
      question: z.string(),
      context: z.string().optional(),
      options: z.array(z.string()).optional(),
      multiple: z.boolean().optional(),
    },
    async ({ question, context, options, multiple }) => {
      if (!sessionId) throw new Error('Sessão MCP ainda não inicializada.');
      const text = context ? `${question}\n\n(${context})` : question;
      const answer = (await store.createPendingRequest(sessionId, 'ask_human', text, { options, multiple })) as AskHumanAnswer;
      return { content: [{ type: 'text' as const, text: answer.text }] };
    },
  );
```

(Leave `confirm_action` and everything else in the file unchanged from Task 4.)

- [ ] **Step 5: Update `src/web/routes.ts`**

Two changes: include `options`/`multiple` in `toSessionJson`'s `pending` field, and handle `InvalidAnswerError` as `400` in the reply route. Replace the full contents with:

```ts
import { Router } from 'express';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Response } from 'express';
import { SessionNotFoundError, PendingMismatchError, InvalidAnswerError } from '../sessions/store.js';
import type { AskHumanAnswer, ConfirmActionAnswer, PendingAnswer, Session, SessionStore } from '../sessions/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', '..', 'public');

function toSessionJson(session: Session) {
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

  router.get('/api/sessions', (req, res) => {
    res.json(store.listSessions(req.userId!));
  });

  router.get('/events', (req, res) => {
    setupSse(res);
    const userId = req.userId!;
    const send = () => {
      res.write(`event: sessions\ndata: ${JSON.stringify(store.listSessions(userId))}\n\n`);
    };
    send();
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
      } else if (err instanceof InvalidAnswerError) {
        res.status(400).json({ error: 'invalid_answer' });
      } else {
        throw err;
      }
    }
  });

  return router;
}
```

Note: this version is intentionally still missing auth/ownership enforcement — routes read `req.userId` (already a valid typed field thanks to Task 2's `declare global` augmentation) but nothing yet guarantees it's set, and no route checks `session.userId` ownership. Until Task 6 adds the `requireWebAuthPage`/`requireWebAuthApi` middleware, `req.userId` is `undefined` at runtime, so `/api/sessions` just returns `[]` rather than crashing. This task's job is only to get the options/multiple data flowing end to end; Task 6 rewrites this file's auth handling completely.

- [ ] **Step 6: Update `public/chat.js`**

Replace the full contents with:

```js
const sessionId = window.location.pathname.split('/').pop();
const messagesEl = document.getElementById('messages');
const replyArea = document.getElementById('reply-area');

function renderMessage(message) {
  const div = document.createElement('div');
  div.className = `message message-${message.role}`;
  div.textContent = `[${message.role}] ${message.text}`;
  messagesEl.appendChild(div);
}

function renderReplyArea(session) {
  replyArea.innerHTML = '';
  if (session.status === 'disconnected') {
    replyArea.textContent = 'Agente desconectado.';
    return;
  }
  if (!session.pending) {
    replyArea.textContent = 'Sem perguntas pendentes.';
    return;
  }

  if (session.pending.kind === 'confirm_action') {
    const approve = document.createElement('button');
    approve.textContent = 'Aprovar';
    approve.onclick = () => sendReply({ requestId: session.pending.id, approved: true });
    const reject = document.createElement('button');
    reject.textContent = 'Rejeitar';
    reject.className = 'secondary';
    reject.onclick = () => sendReply({ requestId: session.pending.id, approved: false });
    replyArea.appendChild(approve);
    replyArea.appendChild(reject);
    return;
  }

  if (session.pending.options && session.pending.options.length > 0) {
    const list = document.createElement('div');
    list.className = 'options-list';
    const inputType = session.pending.multiple ? 'checkbox' : 'radio';
    for (const option of session.pending.options) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = inputType;
      input.name = 'option';
      input.value = option;
      label.appendChild(input);
      label.appendChild(document.createTextNode(option));
      list.appendChild(label);
    }
    const button = document.createElement('button');
    button.textContent = 'Enviar';
    button.onclick = () => {
      const checked = [...list.querySelectorAll('input:checked')].map((el) => el.value);
      if (checked.length === 0) return;
      sendReply({ requestId: session.pending.id, text: checked.join(', ') });
    };
    replyArea.appendChild(list);
    replyArea.appendChild(button);
    return;
  }

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Digite sua resposta...';
  const button = document.createElement('button');
  button.textContent = 'Enviar';
  button.onclick = () => sendReply({ requestId: session.pending.id, text: input.value });
  replyArea.appendChild(input);
  replyArea.appendChild(button);
}

async function sendReply(body) {
  const res = await fetch(`/api/session/${sessionId}/reply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error';
    errorDiv.textContent = `Erro ao responder (${res.status}).`;
    replyArea.appendChild(errorDiv);
  }
}

fetch(`/api/session/${sessionId}`)
  .then((r) => r.json())
  .then((session) => {
    session.messages.forEach(renderMessage);
    renderReplyArea(session);
  });

const events = new EventSource(`/session/${sessionId}/events`);
events.addEventListener('update', (event) => {
  const { message, session } = JSON.parse(event.data);
  renderMessage(message);
  if (session) renderReplyArea(session);
});
```

- [ ] **Step 7: Commit**

```bash
git add src/sessions/store.ts src/sessions/store.test.ts src/mcp/server.ts src/web/routes.ts public/chat.js
git commit -m "feat: support radio/checkbox choices in ask_human"
```

---

## Task 6: Enforce session ownership on the web routes

**Files:**
- Modify: `src/web/routes.ts`
- Modify: `src/server.ts`

**Interfaces:**
- Consumes: `requireWebAuthPage`, `requireWebAuthApi` from `src/auth/webAuth.ts` (Task 2); `SessionStore#listSessions(userId)` (Task 3).
- Produces: `createWebRouter(store: SessionStore): Router` — same export name/signature as before, now with real auth + ownership enforcement.

- [ ] **Step 1: Replace `src/web/routes.ts` with the final, auth-enforced version**

```ts
import { Router } from 'express';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Response } from 'express';
import { SessionNotFoundError, PendingMismatchError, InvalidAnswerError } from '../sessions/store.js';
import type { AskHumanAnswer, ConfirmActionAnswer, PendingAnswer, Session, SessionStore } from '../sessions/store.js';
import { requireWebAuthPage, requireWebAuthApi } from '../auth/webAuth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', '..', 'public');

function toSessionJson(session: Session) {
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

export function createWebRouter(store: SessionStore): Router {
  const router = Router();
  router.use(express.json());

  router.get('/', requireWebAuthPage, (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  router.get('/session/:id', requireWebAuthPage, (req, res) => {
    const session = store.getSession(req.params.id);
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
    const session = store.getSession(req.params.id);
    if (!session || session.userId !== req.userId) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(toSessionJson(session));
  });

  router.get('/session/:id/events', requireWebAuthApi, (req, res) => {
    const { id } = req.params;
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
    const { id } = req.params;
    const session = store.getSession(id);
    if (!session || session.userId !== req.userId) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
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
      } else if (err instanceof InvalidAnswerError) {
        res.status(400).json({ error: 'invalid_answer' });
      } else {
        throw err;
      }
    }
  });

  return router;
}
```

- [ ] **Step 2: Update `src/server.ts` — serve `/` only through the authenticated route**

`express.static` must not auto-serve `public/index.html` at `/` (that would bypass `requireWebAuthPage`). Change the static-files line to disable its automatic `index.html` lookup. Replace the full contents of `src/server.ts` with:

```ts
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db/index.js';
import { attachUser } from './auth/webAuth.js';
import { createAuthRouter } from './web/authRoutes.js';
import { createPairingRouter } from './web/pairingRoutes.js';
import { SessionStore } from './sessions/store.js';
import { createMcpRouter } from './mcp/server.js';
import { createWebRouter } from './web/routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const store = new SessionStore();
const app = express();
const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? 'http://localhost:5002';

app.use(attachUser(db));
app.use(createAuthRouter(db));
app.use(createPairingRouter(db, publicBaseUrl));
app.use('/mcp', createMcpRouter(store, db));
app.use(createWebRouter(store));
app.use(express.static(path.join(__dirname, '..', 'public'), { index: false }));

const port = Number(process.env.PORT) || 5002;
app.listen(port, () => {
  console.log(`remote-controll MCP ouvindo em http://localhost:${port}`);
});
```

- [ ] **Step 3: Verify ownership manually**

Run `npm run dev`. Sign up two different users (`ana@example.com` and `bruno@example.com`, different cookie jars via `curl -c`). Pair an agent and approve it as `ana`. Then:

```bash
curl -s -b <bruno-cookie-jar> http://localhost:5002/api/sessions
```
Expected: `[]` (bruno sees nothing).

```bash
curl -s -b <ana-cookie-jar> http://localhost:5002/api/sessions
```
Expected: the session paired under ana's account.

```bash
curl -s -b <bruno-cookie-jar> http://localhost:5002/api/session/<ana-session-id>
```
Expected: `404`.

```bash
curl -s http://localhost:5002/api/sessions
```
(no cookie) Expected: `401`.

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5002/
```
(no cookie) Expected: `302` (redirect to `/login`).

Stop the dev server after verifying.

- [ ] **Step 4: Commit**

```bash
git add src/web/routes.ts src/server.ts
git commit -m "feat: enforce per-user session ownership on the web routes"
```

---

## Task 7: Visual redesign

**Files:**
- Modify: `public/style.css`
- Modify: `public/index.html`
- Modify: `public/sessions.js`
- Modify: `public/session.html`
- Modify: `public/chat.js`

**Interfaces:** None — purely presentational, no exported functions change.

- [ ] **Step 1: Replace `public/style.css`**

```css
:root {
  --color-bg: #f4f5f7;
  --color-surface: #ffffff;
  --color-border: #dfe3e8;
  --color-text: #1f2430;
  --color-muted: #6b7280;
  --color-primary: #4338ca;
  --color-primary-hover: #3730a3;
  --color-danger: #b91c1c;
  --radius: 8px;
  --shadow: 0 1px 2px rgba(16, 24, 40, 0.05), 0 1px 3px rgba(16, 24, 40, 0.06);
}

* { box-sizing: border-box; }

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: var(--color-bg);
  color: var(--color-text);
  margin: 0;
}

.topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.5rem;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
}

.topbar h1 { font-size: 1.1rem; margin: 0; }
.topbar a { color: inherit; text-decoration: none; }

.page {
  max-width: 720px;
  margin: 0 auto;
  padding: 1.5rem;
}

.session-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.75rem; }
.session-list li { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius); box-shadow: var(--shadow); }
.session-list a { display: flex; justify-content: space-between; align-items: center; padding: 0.9rem 1.1rem; text-decoration: none; color: var(--color-text); gap: 0.75rem; }
.session-list .workspace { font-size: 0.8rem; color: var(--color-muted); display: block; }

.badge { font-size: 0.75rem; font-weight: 600; padding: 0.15rem 0.6rem; border-radius: 999px; text-transform: uppercase; letter-spacing: 0.02em; white-space: nowrap; }
.badge-idle { background: #e5e7eb; color: #374151; }
.badge-waiting { background: #fef3c7; color: #92400e; }
.badge-disconnected { background: #fee2e2; color: #991b1b; }

#messages { display: flex; flex-direction: column; gap: 0.6rem; margin-bottom: 1.25rem; }
.message { padding: 0.65rem 0.9rem; border-radius: var(--radius); background: var(--color-surface); border: 1px solid var(--color-border); max-width: 80%; }
.message-agent { align-self: flex-start; }
.message-human { align-self: flex-end; background: #eef2ff; border-color: #c7d2fe; }
.message-system { align-self: center; font-style: italic; color: var(--color-muted); background: transparent; border: none; }

#reply-area { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; }
#reply-area input[type="text"] { flex: 1; padding: 0.55rem 0.75rem; border: 1px solid var(--color-border); border-radius: var(--radius); font-size: 0.95rem; }
.options-list { display: flex; flex-direction: column; gap: 0.4rem; width: 100%; }
.options-list label { display: flex; align-items: center; gap: 0.5rem; }

button { background: var(--color-primary); color: white; border: none; border-radius: var(--radius); padding: 0.55rem 1.1rem; font-size: 0.95rem; cursor: pointer; }
button:hover { background: var(--color-primary-hover); }
button.secondary { background: var(--color-surface); color: var(--color-text); border: 1px solid var(--color-border); }

.auth-page { display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
.auth-card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius); box-shadow: var(--shadow); padding: 2rem; width: 320px; display: flex; flex-direction: column; gap: 0.9rem; }
.auth-card h1 { font-size: 1.25rem; margin: 0 0 0.25rem; }
.auth-card label { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.9rem; color: var(--color-muted); }
.auth-card input { padding: 0.55rem 0.7rem; border: 1px solid var(--color-border); border-radius: var(--radius); font-size: 0.95rem; }
.auth-switch { font-size: 0.85rem; text-align: center; color: var(--color-muted); margin: 0; }

.error { color: var(--color-danger); font-size: 0.85rem; margin: 0; }
```

- [ ] **Step 2: Replace `public/index.html`**

```html
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>remote-controll — Sessões</title>
  <link rel="stylesheet" href="/style.css" />
</head>
<body>
  <header class="topbar">
    <h1>Sessões conectadas</h1>
    <button id="logout" class="secondary">Sair</button>
  </header>
  <main class="page">
    <ul id="sessions" class="session-list"></ul>
    <p id="empty" hidden>Nenhum agente conectado ainda.</p>
  </main>
  <script src="/sessions.js"></script>
</body>
</html>
```

- [ ] **Step 3: Replace `public/sessions.js`**

```js
const list = document.getElementById('sessions');
const empty = document.getElementById('empty');

function render(sessions) {
  list.innerHTML = '';
  empty.hidden = sessions.length > 0;
  for (const session of sessions) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = `/session/${session.id}`;

    const label = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = session.clientName;
    const workspace = document.createElement('span');
    workspace.className = 'workspace';
    workspace.textContent = session.workspace;
    label.appendChild(name);
    label.appendChild(workspace);

    const badge = document.createElement('span');
    badge.className = `badge badge-${session.status}`;
    badge.textContent = session.status;

    a.appendChild(label);
    a.appendChild(badge);
    li.appendChild(a);
    list.appendChild(li);
  }
}

fetch('/api/sessions').then((r) => r.json()).then(render);

const events = new EventSource('/events');
events.addEventListener('sessions', (event) => {
  render(JSON.parse(event.data));
});

document.getElementById('logout').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login';
});
```

- [ ] **Step 4: Replace `public/session.html`**

```html
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>remote-controll — Chat</title>
  <link rel="stylesheet" href="/style.css" />
</head>
<body>
  <header class="topbar">
    <h1><a href="/">&larr; Sessões</a></h1>
    <button id="logout" class="secondary">Sair</button>
  </header>
  <main class="page">
    <div id="messages"></div>
    <div id="reply-area"></div>
  </main>
  <script src="/chat.js"></script>
</body>
</html>
```

- [ ] **Step 5: Add the logout handler to `public/chat.js`**

Add this line at the end of the file (after the existing `events.addEventListener('update', ...)` block, keep everything else from Task 5 unchanged):

```js
document.getElementById('logout').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login';
});
```

- [ ] **Step 6: Visual check**

Run `npm run dev`, log in through the browser, and look at `/`, `/session/:id` (with an active paired session), `/login`, `/signup`, and `/pair/:code`. Confirm: consistent card/badge styling, no layout overflow at ~400px width (resize the browser window), "Sair" button works and redirects to `/login`. Stop the dev server after checking.

- [ ] **Step 7: Commit**

```bash
git add public/style.css public/index.html public/sessions.js public/session.html public/chat.js
git commit -m "feat: redesign the UI with a consistent enterprise visual style"
```

---

## Task 8: Reference client pairing support + full end-to-end verification

**Files:**
- Modify: `scripts/test-client.ts`

**Interfaces:** None new — this is the manual-testing helper, not consumed by any other module.

- [ ] **Step 1: Replace `scripts/test-client.ts`**

```ts
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const baseUrl = process.env.MCP_BASE_URL ?? 'http://localhost:5002';
const tokenFile = path.join(__dirname, '.mcp-token.json');
const workspace = process.env.MCP_WORKSPACE ?? process.cwd();

const toolName = process.argv[2];
const toolArg = process.argv[3] ?? 'Qual é a cor do céu?';
const optionsArg = process.argv[4];
const multipleArg = process.argv[5] === 'multiple';

const HUMAN_RESPONSE_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const CALL_OPTIONS = {
  timeout: HUMAN_RESPONSE_TIMEOUT_MS,
  resetTimeoutOnProgress: true,
  maxTotalTimeout: HUMAN_RESPONSE_TIMEOUT_MS,
};

function loadToken(): string | undefined {
  if (!existsSync(tokenFile)) return undefined;
  try {
    const data = JSON.parse(readFileSync(tokenFile, 'utf8'));
    if (data.expiresAt && new Date(data.expiresAt).getTime() > Date.now()) {
      return data.token;
    }
  } catch {
    // arquivo corrompido — ignora e pareia de novo
  }
  return undefined;
}

function saveToken(token: string, expiresAt: string): void {
  writeFileSync(tokenFile, JSON.stringify({ token, expiresAt }, null, 2));
}

async function pair(): Promise<string> {
  const startRes = await fetch(`${baseUrl}/api/mcp/pairing/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspace }),
  });
  const { code, verifyUrl } = await startRes.json();
  console.log(`Abra esta URL e aprove o agente: ${verifyUrl}`);

  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const pollRes = await fetch(`${baseUrl}/api/mcp/pairing/${code}`);
    if (!pollRes.ok) throw new Error('Pareamento expirou ou não existe mais.');
    const pairing = await pollRes.json();
    if (pairing.status === 'approved') {
      saveToken(pairing.token, pairing.expiresAt);
      console.log('Pareamento aprovado.');
      return pairing.token;
    }
    if (pairing.status === 'rejected') {
      throw new Error('Pareamento rejeitado.');
    }
    console.log('Ainda aguardando aprovação...');
  }
}

async function getToken(): Promise<string> {
  return loadToken() ?? pair();
}

function buildClient(token: string): { client: Client; transport: StreamableHTTPClientTransport } {
  const client = new Client({ name: 'test-client', version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}`, 'X-Workspace': workspace } },
  });
  return { client, transport };
}

async function main() {
  let token = await getToken();
  let { client, transport } = buildClient(token);

  try {
    await client.connect(transport);
  } catch {
    console.log('Token inválido/expirado, pareando de novo...');
    token = await pair();
    ({ client, transport } = buildClient(token));
    await client.connect(transport);
  }

  const { tools } = await client.listTools();
  console.log('Tools disponíveis:', tools.map((t) => t.name).join(', '));

  if (toolName === 'ask_human') {
    const args: Record<string, unknown> = { question: toolArg };
    if (optionsArg) {
      args.options = optionsArg.split(',').map((s) => s.trim());
      args.multiple = multipleArg;
    }
    console.log(`Chamando ask_human — aguardando resposta pelo chat em ${baseUrl}/ ...`);
    const result = await client.callTool({ name: 'ask_human', arguments: args }, undefined, CALL_OPTIONS);
    console.log('Resposta recebida:', result.content);
  } else if (toolName === 'confirm_action') {
    console.log(`Chamando confirm_action — aguardando confirmação pelo chat em ${baseUrl}/ ...`);
    const result = await client.callTool(
      { name: 'confirm_action', arguments: { description: toolArg } },
      undefined,
      CALL_OPTIONS,
    );
    console.log('Resposta recebida:', result.content);
  }

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Add the token file to `.gitignore`**

Add this line to `.gitignore`:

```
scripts/.mcp-token.json
```

- [ ] **Step 3: Full end-to-end manual verification**

Run `npm run dev`. Delete `scripts/.mcp-token.json` if it exists from earlier testing.

```bash
npm run test:client -- ask_human "Qual sua cor favorita?" "Vermelho,Verde,Azul"
```
Expected: prints a `verifyUrl`. Open it in the browser — since there's no web session yet, it redirects to `/login`; sign up or log in, land back on `/pair/:code`, see the workspace, click **Aprovar**. The terminal should print "Pareamento aprovado.", then "Tools disponíveis: ask_human, confirm_action", then wait on the tool call. Open the session from `/`, confirm it shows **radio buttons** for Vermelho/Verde/Azul (not a text box). Pick one and submit. Terminal should print `Resposta recebida: [ { type: 'text', text: '<opção escolhida>' } ]`.

Run again immediately:
```bash
npm run test:client -- confirm_action "Rodar o build de novo?"
```
Expected: **no** pairing/login step this time (reuses the saved token from `scripts/.mcp-token.json`) — goes straight to "Tools disponíveis: ...". Approve/reject it from the chat, confirm the response prints correctly.

Run a multi-select case:
```bash
npm run test:client -- ask_human "Quais linguagens você usa?" "TypeScript,Python,Go" multiple
```
Expected: chat shows **checkboxes**; pick two, submit; terminal prints both, comma-separated.

Stop the dev server after verifying.

- [ ] **Step 4: Commit**

```bash
git add scripts/test-client.ts .gitignore
git commit -m "feat: add pairing support and token persistence to the reference test client"
```
