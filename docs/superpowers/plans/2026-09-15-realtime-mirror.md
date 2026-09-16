# Espelho em tempo real do vide-code — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar o `remote-controll` de servidor MCP em um espelho remoto em tempo real do vide-code: login simples + personal access token, conexão WebSocket de saída vinda do vide-code, lista de conversas abertas, chat ao vivo (texto + atividade de tools + diffs), enviar mensagem, parar, e responder `askUser`.

**Architecture:** Um `AgentHub` em memória (substitui o `SessionStore` atual) é o estado central. Uma nova rota WS (`/agent/ws`) recebe conexões do vide-code autenticadas por Bearer token e atualiza o hub a partir de eventos (`conversation_opened`/`conversation_closed`/`snapshot`); a UI web lê o mesmo hub via SSE (padrão já usado hoje) e aciona comandos (`send_message`/`stop_response`/`answer_question`) via HTTP, que o hub encaminha pela conexão WS certa. Todo o stack OAuth 2.1 + MCP é removido.

**Tech Stack:** Node.js + TypeScript (ESM, imports com `.js`), Express 5, `ws` (WebSocket server), `node:sqlite`, `zod` v4, `node:test` nativo.

**Spec:** `docs/superpowers/specs/2026-09-15-realtime-mirror-design.md` (e o contrato irmão em `vide-code/docs/superpowers/specs/2026-09-15-remote-controll-integration-design.md`, implementado separadamente).

## Global Constraints

- Imports internos sempre com extensão `.js`, mesmo apontando pra arquivos `.ts` (convenção ESM/NodeNext já usada no repo).
- `strict: true` no `tsconfig.json` — sem `any` implícito, sem gambiarra de tipos.
- Testes só com `node:test` + `node:assert/strict`, um arquivo `*.test.ts` por módulo, listados manualmente no script `test` do `package.json` (convenção atual — não há test runner com auto-discovery).
- `zod` v4: `z.record` exige dois argumentos (`z.record(keySchema, valueSchema)`).
- Toda mensagem recebida pela conexão WS passa por validação `zod` antes de tocar o `AgentHub` — nunca confiar cegamente em payload de uma conexão externa.
- Sem persistência de conversas fechadas — tudo em memória, mesmo princípio do MVP anterior.
- Textos voltados ao usuário e comentários de código em português, seguindo o padrão já estabelecido no repo.

---

## Task 1: Remover o stack OAuth 2.1 + MCP

**Files:**
- Delete: `src/mcp/server.ts` (e a pasta `src/mcp/` inteira)
- Delete: `src/auth/mcpAuth.ts`
- Delete: `src/auth/pkce.ts`, `src/auth/pkce.test.ts`
- Delete: `src/web/oauthRoutes.ts`
- Delete: `src/db/oauthClients.ts`, `src/db/oauthClients.test.ts`
- Delete: `src/db/oauthCodes.ts`, `src/db/oauthCodes.test.ts`
- Delete: `src/db/oauthTokens.ts`, `src/db/oauthTokens.test.ts`
- Delete: `public/authorize.html`, `public/authorize.js`
- Delete: `scripts/test-client.ts` (será recriado do zero na Task 12, falando o protocolo novo)
- Modify: `src/db/index.ts`
- Modify: `src/server.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `createDb(dbPath)` continua exportando o mesmo `DatabaseSync`, agora só com as tabelas `users` e `web_sessions`.

- [ ] **Step 1: Apagar os arquivos do stack OAuth/MCP**

```bash
rm -rf src/mcp
rm src/auth/mcpAuth.ts src/auth/pkce.ts src/auth/pkce.test.ts
rm src/web/oauthRoutes.ts
rm src/db/oauthClients.ts src/db/oauthClients.test.ts
rm src/db/oauthCodes.ts src/db/oauthCodes.test.ts
rm src/db/oauthTokens.ts src/db/oauthTokens.test.ts
rm public/authorize.html public/authorize.js
rm scripts/test-client.ts
```

- [ ] **Step 2: Remover as tabelas OAuth do schema**

Editar `src/db/index.ts` — o `db.exec(...)` deve conter só isto:

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

    CREATE TABLE IF NOT EXISTS web_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
  `);
  return db;
}

export function defaultDbPath(): string {
  return process.env.DB_PATH ?? path.join(__dirname, '..', '..', 'data.sqlite');
}
```

- [ ] **Step 3: Atualizar `src/server.ts` pra parar de referenciar MCP/OAuth**

```ts
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb, defaultDbPath } from './db/index.js';
import { attachUser } from './auth/webAuth.js';
import { createAuthRouter } from './web/authRoutes.js';
import { SessionStore } from './sessions/store.js';
import { createWebRouter } from './web/routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = createDb(defaultDbPath());
const store = new SessionStore();
const app = express();

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});

app.use(attachUser(db));
app.use(createAuthRouter(db));
app.use(createWebRouter(store));
app.use(express.static(path.join(__dirname, '..', 'public'), { index: false }));

const STALE_SESSION_MS = 2 * 60 * 1000;
setInterval(() => store.sweepStaleSessions(STALE_SESSION_MS), 30_000).unref();

const port = Number(process.env.PORT) || 5002;
app.listen(port, () => {
  console.log(`remote-controll ouvindo em http://localhost:${port}`);
});
```

(Este `server.ts` ainda é transitório — `SessionStore`/`createWebRouter(store)` somem nas Tasks 5, 8 e 9. Aqui só precisa voltar a compilar e subir.)

- [ ] **Step 4: Remover a dependência do SDK MCP e atualizar o script de teste**

Editar `package.json`:

```json
{
  "name": "remote-controll",
  "version": "1.0.0",
  "description": "",
  "main": "index.js",
  "directories": { "doc": "docs" },
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p .",
    "test": "tsx --test src/sessions/store.test.ts src/auth/password.test.ts src/db/users.test.ts src/db/webSessions.test.ts",
    "test:client": "tsx scripts/test-client.ts"
  },
  "keywords": [],
  "author": "",
  "license": "ISC",
  "type": "module",
  "dependencies": {
    "express": "^5.2.1",
    "zod": "^4.6.5"
  },
  "devDependencies": {
    "@types/express": "^5.0.6",
    "@types/node": "^26.5.1",
    "tsx": "^4.23.13",
    "typescript": "^7.0.2"
  }
}
```

```bash
npm install
```

- [ ] **Step 5: Rodar os testes e o build pra confirmar que nada ficou quebrado**

```bash
npm test
npm run build
```

Esperado: os 4 arquivos de teste restantes passam; `tsc -p .` compila sem erro (nada mais referencia os arquivos apagados).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: remover stack OAuth 2.1 e servidor MCP"
```

---

## Task 2: Personal access tokens (`agentTokens`)

**Files:**
- Create: `src/db/agentTokens.ts`
- Create: `src/db/agentTokens.test.ts`
- Modify: `src/db/index.ts`
- Modify: `package.json` (script `test`)

**Interfaces:**
- Produces: `issueAgentToken(db, userId, label) -> { token: AgentToken, secret: string }`, `findUserIdByAgentToken(db, secret) -> string | undefined`, `listAgentTokens(db, userId) -> AgentToken[]`, `revokeAgentToken(db, userId, tokenId) -> boolean`, tipo `AgentToken { id, userId, label, createdAt, lastUsedAt }`.

- [ ] **Step 1: Adicionar a tabela `agent_tokens` ao schema**

Em `src/db/index.ts`, adicionar dentro do mesmo `db.exec(...)` (depois de `web_sessions`):

```sql
    CREATE TABLE IF NOT EXISTS agent_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      token_hash TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_used_at TEXT
    );
```

- [ ] **Step 2: Escrever o teste**

`src/db/agentTokens.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from './index.js';
import { createUser } from './users.js';
import { issueAgentToken, findUserIdByAgentToken, listAgentTokens, revokeAgentToken } from './agentTokens.js';

test('issueAgentToken + findUserIdByAgentToken', () => {
  const db = createDb(':memory:');
  const user = createUser(db, 'a@a.com', 'hash');
  const { secret } = issueAgentToken(db, user.id, 'notebook');
  assert.equal(findUserIdByAgentToken(db, secret), user.id);
});

test('findUserIdByAgentToken retorna undefined para token desconhecido', () => {
  const db = createDb(':memory:');
  assert.equal(findUserIdByAgentToken(db, 'nao-existe'), undefined);
});

test('listAgentTokens só retorna tokens do usuário', () => {
  const db = createDb(':memory:');
  const userA = createUser(db, 'a@a.com', 'hash');
  const userB = createUser(db, 'b@b.com', 'hash');
  issueAgentToken(db, userA.id, 'a-token');
  issueAgentToken(db, userB.id, 'b-token');

  const tokens = listAgentTokens(db, userA.id);
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].label, 'a-token');
});

test('revokeAgentToken remove o token e retorna true', () => {
  const db = createDb(':memory:');
  const user = createUser(db, 'a@a.com', 'hash');
  const { token, secret } = issueAgentToken(db, user.id, 'notebook');

  assert.equal(revokeAgentToken(db, user.id, token.id), true);
  assert.equal(findUserIdByAgentToken(db, secret), undefined);
});

test('revokeAgentToken retorna false para token de outro usuário', () => {
  const db = createDb(':memory:');
  const userA = createUser(db, 'a@a.com', 'hash');
  const userB = createUser(db, 'b@b.com', 'hash');
  const { token } = issueAgentToken(db, userA.id, 'notebook');

  assert.equal(revokeAgentToken(db, userB.id, token.id), false);
});
```

- [ ] **Step 3: Rodar e confirmar que falha (módulo ainda não existe)**

```bash
npx tsx --test src/db/agentTokens.test.ts
```

Esperado: FAIL — `Cannot find module './agentTokens.js'`.

- [ ] **Step 4: Implementar `src/db/agentTokens.ts`**

```ts
import type { DatabaseSync } from 'node:sqlite';
import { randomUUID, randomBytes, createHash } from 'node:crypto';

export interface AgentToken {
  id: string;
  userId: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
}

interface AgentTokenRow {
  id: string;
  user_id: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function toAgentToken(row: AgentTokenRow): AgentToken {
  return { id: row.id, userId: row.user_id, label: row.label, createdAt: row.created_at, lastUsedAt: row.last_used_at };
}

export function issueAgentToken(db: DatabaseSync, userId: string, label: string): { token: AgentToken; secret: string } {
  const secret = randomBytes(32).toString('hex');
  const token: AgentToken = { id: randomUUID(), userId, label, createdAt: new Date().toISOString(), lastUsedAt: null };
  db.prepare(
    'INSERT INTO agent_tokens (id, user_id, token_hash, label, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(token.id, token.userId, hashToken(secret), token.label, token.createdAt, null);
  return { token, secret };
}

export function findUserIdByAgentToken(db: DatabaseSync, secret: string): string | undefined {
  const row = db.prepare('SELECT id, user_id FROM agent_tokens WHERE token_hash = ?').get(hashToken(secret)) as
    | { id: string; user_id: string }
    | undefined;
  if (!row) return undefined;
  db.prepare('UPDATE agent_tokens SET last_used_at = ? WHERE id = ?').run(new Date().toISOString(), row.id);
  return row.user_id;
}

export function listAgentTokens(db: DatabaseSync, userId: string): AgentToken[] {
  const rows = db
    .prepare('SELECT id, user_id, label, created_at, last_used_at FROM agent_tokens WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId) as AgentTokenRow[];
  return rows.map(toAgentToken);
}

export function revokeAgentToken(db: DatabaseSync, userId: string, tokenId: string): boolean {
  const result = db.prepare('DELETE FROM agent_tokens WHERE id = ? AND user_id = ?').run(tokenId, userId);
  return result.changes > 0;
}
```

- [ ] **Step 5: Rodar de novo e confirmar que passa**

```bash
npx tsx --test src/db/agentTokens.test.ts
```

Esperado: os 5 testes passam.

- [ ] **Step 6: Adicionar ao script `test` do `package.json`**

```json
"test": "tsx --test src/sessions/store.test.ts src/auth/password.test.ts src/db/users.test.ts src/db/webSessions.test.ts src/db/agentTokens.test.ts",
```

```bash
npm test
```

- [ ] **Step 7: Commit**

```bash
git add src/db/agentTokens.ts src/db/agentTokens.test.ts src/db/index.ts package.json
git commit -m "feat: adicionar personal access tokens (agentTokens)"
```

---

## Task 3: Autenticação da conexão WS (`agentAuth`)

**Files:**
- Create: `src/auth/agentAuth.ts`
- Create: `src/auth/agentAuth.test.ts`
- Modify: `package.json` (script `test`)

**Interfaces:**
- Consumes: `findUserIdByAgentToken` de `src/db/agentTokens.ts` (Task 2).
- Produces: `extractBearerToken(headers) -> string | undefined`, `authenticateAgent(db, headers) -> string | undefined`.

- [ ] **Step 1: Escrever o teste**

`src/auth/agentAuth.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../db/index.js';
import { createUser } from '../db/users.js';
import { issueAgentToken } from '../db/agentTokens.js';
import { authenticateAgent, extractBearerToken } from './agentAuth.js';

test('extractBearerToken lê o header Authorization', () => {
  assert.equal(extractBearerToken({ authorization: 'Bearer abc123' }), 'abc123');
});

test('extractBearerToken retorna undefined sem header Bearer', () => {
  assert.equal(extractBearerToken({}), undefined);
  assert.equal(extractBearerToken({ authorization: 'Basic abc' }), undefined);
});

test('authenticateAgent resolve o userId de um token válido', () => {
  const db = createDb(':memory:');
  const user = createUser(db, 'a@a.com', 'hash');
  const { secret } = issueAgentToken(db, user.id, 'notebook');

  assert.equal(authenticateAgent(db, { authorization: `Bearer ${secret}` }), user.id);
});

test('authenticateAgent retorna undefined para token inválido', () => {
  const db = createDb(':memory:');
  assert.equal(authenticateAgent(db, { authorization: 'Bearer nao-existe' }), undefined);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
npx tsx --test src/auth/agentAuth.test.ts
```

Esperado: FAIL — módulo `./agentAuth.js` não existe.

- [ ] **Step 3: Implementar `src/auth/agentAuth.ts`**

```ts
import type { DatabaseSync } from 'node:sqlite';
import type { IncomingHttpHeaders } from 'node:http';
import { findUserIdByAgentToken } from '../db/agentTokens.js';

export function extractBearerToken(headers: IncomingHttpHeaders): string | undefined {
  const header = headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return undefined;
  return header.slice('Bearer '.length).trim();
}

export function authenticateAgent(db: DatabaseSync, headers: IncomingHttpHeaders): string | undefined {
  const token = extractBearerToken(headers);
  return token ? findUserIdByAgentToken(db, token) : undefined;
}
```

- [ ] **Step 4: Rodar de novo e confirmar que passa**

```bash
npx tsx --test src/auth/agentAuth.test.ts
```

- [ ] **Step 5: Adicionar ao script `test`**

```json
"test": "tsx --test src/sessions/store.test.ts src/auth/password.test.ts src/auth/agentAuth.test.ts src/db/users.test.ts src/db/webSessions.test.ts src/db/agentTokens.test.ts",
```

```bash
npm test
```

- [ ] **Step 6: Commit**

```bash
git add src/auth/agentAuth.ts src/auth/agentAuth.test.ts package.json
git commit -m "feat: autenticação por Bearer token pra conexões do agente"
```

---

## Task 4: Protocolo WS (`src/agent/protocol.ts`)

**Files:**
- Create: `src/agent/protocol.ts`
- Create: `src/agent/protocol.test.ts`
- Modify: `package.json` (script `test`)

**Interfaces:**
- Produces (tipos e schemas usados pelas Tasks 5, 6, 8, 9):
  - `UserQuestion`, `ActivityEntry`, `PendingQuestion`, `ConversationStatus`, `ConversationSnapshot` (tipos).
  - `wsInboundMessageSchema` (zod) — valida mensagens que chegam do vide-code.
  - `sendMessageCommandSchema`, `stopResponseCommandSchema`, `answerQuestionCommandSchema` (zod).
  - `AgentCommandInput` — union usada por `AgentHub.sendCommand`.

- [ ] **Step 1: Escrever o teste**

`src/agent/protocol.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wsInboundMessageSchema, sendMessageCommandSchema, answerQuestionCommandSchema } from './protocol.js';

test('wsInboundMessageSchema aceita conversation_opened válido', () => {
  const result = wsInboundMessageSchema.safeParse({
    type: 'event',
    event: 'conversation_opened',
    payload: { id: 'c1', title: 'Teste' },
  });
  assert.equal(result.success, true);
});

test('wsInboundMessageSchema aceita snapshot com activity e pendingQuestion', () => {
  const result = wsInboundMessageSchema.safeParse({
    type: 'event',
    event: 'snapshot',
    payload: {
      id: 'c1',
      status: 'waiting_user',
      activity: [{ id: 'a1', kind: 'tool_call', text: 'Lendo arquivo', createdAt: new Date().toISOString() }],
      pendingQuestion: {
        messageId: 'm1',
        questions: [
          {
            id: 'q1',
            question: 'Continuar?',
            type: 'radio',
            options: [
              { value: 'sim', label: 'Sim' },
              { value: 'nao', label: 'Não' },
            ],
            default: 'sim',
          },
        ],
      },
    },
  });
  assert.equal(result.success, true);
});

test('wsInboundMessageSchema rejeita payload sem id', () => {
  const result = wsInboundMessageSchema.safeParse({ type: 'event', event: 'conversation_closed', payload: {} });
  assert.equal(result.success, false);
});

test('sendMessageCommandSchema exige message não vazio', () => {
  const result = sendMessageCommandSchema.safeParse({
    type: 'command',
    requestId: 'r1',
    operation: 'send_message',
    payload: { id: 'c1', message: '' },
  });
  assert.equal(result.success, false);
});

test('answerQuestionCommandSchema aceita skipped sem answers', () => {
  const result = answerQuestionCommandSchema.safeParse({
    type: 'command',
    requestId: 'r1',
    operation: 'answer_question',
    payload: { id: 'c1', messageId: 'm1', skipped: true },
  });
  assert.equal(result.success, true);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
npx tsx --test src/agent/protocol.test.ts
```

- [ ] **Step 3: Implementar `src/agent/protocol.ts`**

```ts
import { z } from 'zod';

export const questionOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
  description: z.string().optional(),
});

export const userQuestionSchema = z.object({
  id: z.string(),
  question: z.string(),
  type: z.enum(['radio', 'checkbox']),
  options: z.array(questionOptionSchema).min(2).max(4),
  default: z.union([z.string(), z.array(z.string())]),
  allowOther: z.boolean().optional(),
});

export const activityEntrySchema = z.object({
  id: z.string(),
  kind: z.enum(['tool_call', 'tool_result', 'diff', 'info']),
  text: z.string(),
  createdAt: z.string(),
});

export const pendingQuestionSchema = z.object({
  messageId: z.string(),
  questions: z.array(userQuestionSchema),
});

export const conversationStatusSchema = z.enum([
  'idle',
  'queued',
  'streaming',
  'waiting_user',
  'completed',
  'cancelled',
  'error',
  'disconnected',
]);

export const conversationSnapshotSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  status: conversationStatusSchema,
  message: z.object({ role: z.literal('assistant'), content: z.string() }).optional(),
  activity: z.array(activityEntrySchema).optional(),
  pendingQuestion: pendingQuestionSchema.optional(),
  error: z.string().optional(),
});

const conversationOpenedEventSchema = z.object({
  type: z.literal('event'),
  event: z.literal('conversation_opened'),
  payload: z.object({ id: z.string(), title: z.string().optional() }),
});

const conversationClosedEventSchema = z.object({
  type: z.literal('event'),
  event: z.literal('conversation_closed'),
  payload: z.object({ id: z.string() }),
});

const snapshotEventSchema = z.object({
  type: z.literal('event'),
  event: z.literal('snapshot'),
  payload: conversationSnapshotSchema,
});

const resultOkSchema = z.object({
  type: z.literal('result'),
  requestId: z.string(),
  ok: z.literal(true),
  result: conversationSnapshotSchema,
});

const resultErrSchema = z.object({
  type: z.literal('result'),
  requestId: z.string(),
  ok: z.literal(false),
  error: z.string(),
});

export const wsInboundMessageSchema = z.union([
  conversationOpenedEventSchema,
  conversationClosedEventSchema,
  snapshotEventSchema,
  resultOkSchema,
  resultErrSchema,
]);

export const sendMessageCommandSchema = z.object({
  type: z.literal('command'),
  requestId: z.string(),
  operation: z.literal('send_message'),
  payload: z.object({ id: z.string(), message: z.string().min(1) }),
});

export const stopResponseCommandSchema = z.object({
  type: z.literal('command'),
  requestId: z.string(),
  operation: z.literal('stop_response'),
  payload: z.object({ id: z.string() }),
});

export const answerQuestionCommandSchema = z.object({
  type: z.literal('command'),
  requestId: z.string(),
  operation: z.literal('answer_question'),
  payload: z.object({
    id: z.string(),
    messageId: z.string(),
    answers: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
    skipped: z.boolean().optional(),
  }),
});

export type QuestionOption = z.infer<typeof questionOptionSchema>;
export type UserQuestion = z.infer<typeof userQuestionSchema>;
export type ActivityEntry = z.infer<typeof activityEntrySchema>;
export type PendingQuestion = z.infer<typeof pendingQuestionSchema>;
export type ConversationStatus = z.infer<typeof conversationStatusSchema>;
export type ConversationSnapshot = z.infer<typeof conversationSnapshotSchema>;
export type WsInboundMessage = z.infer<typeof wsInboundMessageSchema>;

type SendMessagePayload = z.infer<typeof sendMessageCommandSchema>['payload'];
type StopResponsePayload = z.infer<typeof stopResponseCommandSchema>['payload'];
type AnswerQuestionPayload = z.infer<typeof answerQuestionCommandSchema>['payload'];

export type AgentCommandInput =
  | { operation: 'send_message'; payload: SendMessagePayload }
  | { operation: 'stop_response'; payload: StopResponsePayload }
  | { operation: 'answer_question'; payload: AnswerQuestionPayload };
```

- [ ] **Step 4: Rodar de novo e confirmar que passa**

```bash
npx tsx --test src/agent/protocol.test.ts
```

- [ ] **Step 5: Adicionar ao script `test`**

```json
"test": "tsx --test src/sessions/store.test.ts src/auth/password.test.ts src/auth/agentAuth.test.ts src/db/users.test.ts src/db/webSessions.test.ts src/db/agentTokens.test.ts src/agent/protocol.test.ts",
```

```bash
npm test
```

- [ ] **Step 6: Commit**

```bash
git add src/agent/protocol.ts src/agent/protocol.test.ts package.json
git commit -m "feat: schemas zod do protocolo WS com o vide-code"
```

---

## Task 5: `AgentHub` (substitui `SessionStore`)

**Files:**
- Create: `src/agent/hub.ts`
- Create: `src/agent/hub.test.ts`
- Delete: `src/sessions/store.ts`, `src/sessions/store.test.ts`
- Modify: `package.json` (script `test`)

**Interfaces:**
- Consumes: `ConversationSnapshot`, `AgentCommandInput` de `src/agent/protocol.ts` (Task 4).
- Produces (usadas pelas Tasks 6, 8, 9):
  - `class AgentHub extends EventEmitter` com:
    - `registerConnection(userId: string, send: (data: string) => void): AgentConnection`
    - `removeConnection(connectionId: string): void`
    - `openConversation(connectionId: string, id: string, title?: string): Conversation`
    - `closeConversation(id: string): void`
    - `applySnapshot(id: string, snapshot: ConversationSnapshot): Conversation`
    - `listConversations(userId: string): Conversation[]`
    - `getConversation(id: string): Conversation | undefined`
    - `sendCommand(input: AgentCommandInput): void`
  - Eventos emitidos: `'conversations-changed'`, `'conversation-updated'` (com o `Conversation` atualizado).
  - `class ConversationNotFoundError extends Error`, `class ConnectionUnavailableError extends Error`.
  - Tipo `Conversation { id, connectionId, userId, title?, status, message?, history: HistoryEntry[], activity: ActivityEntry[], pendingQuestion?, error?, connectedAt, lastSeenAt }`.
  - Tipo `HistoryEntry { id, role: 'human' | 'agent' | 'system', text, createdAt }`.

- [ ] **Step 1: Escrever o teste**

`src/agent/hub.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentHub, ConversationNotFoundError, ConnectionUnavailableError } from './hub.js';

test('openConversation cria conversa vinculada ao usuário da conexão', () => {
  const hub = new AgentHub();
  const connection = hub.registerConnection('user-1', () => {});
  const conversation = hub.openConversation(connection.id, 'c1', 'Título');
  assert.equal(conversation.status, 'idle');
  assert.deepEqual(conversation.activity, []);
  assert.deepEqual(conversation.history, []);
  assert.equal(conversation.userId, 'user-1');
});

test('listConversations só retorna conversas do userId informado', () => {
  const hub = new AgentHub();
  const connectionA = hub.registerConnection('user-1', () => {});
  const connectionB = hub.registerConnection('user-2', () => {});
  hub.openConversation(connectionA.id, 'ca', 'A');
  hub.openConversation(connectionB.id, 'cb', 'B');

  const forUser1 = hub.listConversations('user-1');
  assert.equal(forUser1.length, 1);
  assert.equal(forUser1[0].id, 'ca');
});

test('closeConversation remove a conversa da listagem', () => {
  const hub = new AgentHub();
  const connection = hub.registerConnection('user-1', () => {});
  hub.openConversation(connection.id, 'c1');
  hub.closeConversation('c1');
  assert.equal(hub.getConversation('c1'), undefined);
});

test('applySnapshot acumula activity entre chamadas', () => {
  const hub = new AgentHub();
  const connection = hub.registerConnection('user-1', () => {});
  hub.openConversation(connection.id, 'c1');

  hub.applySnapshot('c1', {
    id: 'c1',
    status: 'streaming',
    activity: [{ id: 'a1', kind: 'tool_call', text: 'passo 1', createdAt: new Date().toISOString() }],
  });
  hub.applySnapshot('c1', {
    id: 'c1',
    status: 'streaming',
    activity: [{ id: 'a2', kind: 'tool_call', text: 'passo 2', createdAt: new Date().toISOString() }],
  });

  const conversation = hub.getConversation('c1')!;
  assert.equal(conversation.activity.length, 2);
  assert.equal(conversation.activity[1].id, 'a2');
});

test('applySnapshot registra o turno do agente em history ao terminar', () => {
  const hub = new AgentHub();
  const connection = hub.registerConnection('user-1', () => {});
  hub.openConversation(connection.id, 'c1');

  hub.applySnapshot('c1', { id: 'c1', status: 'streaming', message: { role: 'assistant', content: 'parcial' } });
  hub.applySnapshot('c1', { id: 'c1', status: 'completed', message: { role: 'assistant', content: 'final' } });

  const conversation = hub.getConversation('c1')!;
  assert.equal(conversation.history.length, 1);
  assert.equal(conversation.history[0].role, 'agent');
  assert.equal(conversation.history[0].text, 'final');
});

test('applySnapshot lança ConversationNotFoundError para conversa desconhecida', () => {
  const hub = new AgentHub();
  assert.throws(() => hub.applySnapshot('nope', { id: 'nope', status: 'idle' }), ConversationNotFoundError);
});

test('removeConnection marca as conversas da conexão como disconnected sem apagá-las', () => {
  const hub = new AgentHub();
  const connection = hub.registerConnection('user-1', () => {});
  hub.openConversation(connection.id, 'c1');

  hub.removeConnection(connection.id);

  const conversation = hub.getConversation('c1');
  assert.equal(conversation?.status, 'disconnected');
});

test('sendCommand lança ConnectionUnavailableError quando a conexão caiu', () => {
  const hub = new AgentHub();
  const connection = hub.registerConnection('user-1', () => {});
  hub.openConversation(connection.id, 'c1');
  hub.removeConnection(connection.id);

  assert.throws(
    () => hub.sendCommand({ operation: 'stop_response', payload: { id: 'c1' } }),
    ConnectionUnavailableError,
  );
});

test('sendCommand lança ConversationNotFoundError para conversa desconhecida', () => {
  const hub = new AgentHub();
  assert.throws(
    () => hub.sendCommand({ operation: 'stop_response', payload: { id: 'nope' } }),
    ConversationNotFoundError,
  );
});

test('sendCommand de send_message registra a mensagem do humano em history e envia pela conexão', () => {
  const hub = new AgentHub();
  const sent: string[] = [];
  const connection = hub.registerConnection('user-1', (data) => sent.push(data));
  hub.openConversation(connection.id, 'c1');

  hub.sendCommand({ operation: 'send_message', payload: { id: 'c1', message: 'oi' } });

  const conversation = hub.getConversation('c1')!;
  assert.equal(conversation.history.length, 1);
  assert.equal(conversation.history[0].role, 'human');
  assert.equal(conversation.history[0].text, 'oi');
  assert.equal(sent.length, 1);
  const parsed = JSON.parse(sent[0]);
  assert.equal(parsed.type, 'command');
  assert.equal(parsed.operation, 'send_message');
  assert.equal(parsed.payload.message, 'oi');
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
npx tsx --test src/agent/hub.test.ts
```

- [ ] **Step 3: Implementar `src/agent/hub.ts`**

```ts
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { ActivityEntry, AgentCommandInput, ConversationSnapshot, ConversationStatus, PendingQuestion } from './protocol.js';

export interface HistoryEntry {
  id: string;
  role: 'human' | 'agent' | 'system';
  text: string;
  createdAt: string;
}

export interface Conversation {
  id: string;
  connectionId: string;
  userId: string;
  title?: string;
  status: ConversationStatus;
  message?: { role: 'assistant'; content: string };
  history: HistoryEntry[];
  activity: ActivityEntry[];
  pendingQuestion?: PendingQuestion;
  error?: string;
  connectedAt: string;
  lastSeenAt: string;
}

export interface AgentConnection {
  id: string;
  userId: string;
  connectedAt: string;
  conversationIds: Set<string>;
  send: (data: string) => void;
}

export class ConversationNotFoundError extends Error {
  constructor(id: string) {
    super(`Conversa não encontrada: ${id}`);
  }
}

export class ConnectionUnavailableError extends Error {
  constructor(id: string) {
    super(`Sem conexão ativa para a conversa: ${id}`);
  }
}

function isTerminal(status: ConversationStatus): boolean {
  return status === 'completed' || status === 'cancelled' || status === 'error';
}

export class AgentHub extends EventEmitter {
  private connections = new Map<string, AgentConnection>();
  private conversations = new Map<string, Conversation>();

  registerConnection(userId: string, send: (data: string) => void): AgentConnection {
    const connection: AgentConnection = {
      id: randomUUID(),
      userId,
      connectedAt: new Date().toISOString(),
      conversationIds: new Set(),
      send,
    };
    this.connections.set(connection.id, connection);
    return connection;
  }

  removeConnection(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (!connection) return;
    this.connections.delete(connectionId);
    for (const conversationId of connection.conversationIds) {
      const conversation = this.conversations.get(conversationId);
      if (!conversation) continue;
      conversation.status = 'disconnected';
      this.emit('conversation-updated', conversation);
    }
    this.emit('conversations-changed');
  }

  openConversation(connectionId: string, id: string, title?: string): Conversation {
    const connection = this.connections.get(connectionId);
    if (!connection) throw new ConnectionUnavailableError(connectionId);
    const now = new Date().toISOString();
    const conversation: Conversation = {
      id,
      connectionId,
      userId: connection.userId,
      title,
      status: 'idle',
      history: [],
      activity: [],
      connectedAt: now,
      lastSeenAt: now,
    };
    this.conversations.set(id, conversation);
    connection.conversationIds.add(id);
    this.emit('conversations-changed');
    return conversation;
  }

  closeConversation(id: string): void {
    const conversation = this.conversations.get(id);
    if (!conversation) return;
    this.connections.get(conversation.connectionId)?.conversationIds.delete(id);
    this.conversations.delete(id);
    this.emit('conversations-changed');
  }

  applySnapshot(id: string, snapshot: ConversationSnapshot): Conversation {
    const existing = this.conversations.get(id);
    if (!existing) throw new ConversationNotFoundError(id);

    const wasTerminal = isTerminal(existing.status);
    existing.title = snapshot.title ?? existing.title;
    existing.status = snapshot.status;
    existing.message = snapshot.message;
    if (snapshot.activity && snapshot.activity.length > 0) {
      existing.activity = [...existing.activity, ...snapshot.activity];
    }
    existing.pendingQuestion = snapshot.pendingQuestion;
    existing.error = snapshot.error;
    existing.lastSeenAt = new Date().toISOString();

    if (!wasTerminal && isTerminal(snapshot.status) && existing.message) {
      existing.history = [
        ...existing.history,
        { id: randomUUID(), role: 'agent', text: existing.message.content, createdAt: existing.lastSeenAt },
      ];
    }

    this.emit('conversation-updated', existing);
    return existing;
  }

  listConversations(userId: string): Conversation[] {
    return [...this.conversations.values()].filter((c) => c.userId === userId);
  }

  getConversation(id: string): Conversation | undefined {
    return this.conversations.get(id);
  }

  sendCommand(input: AgentCommandInput): void {
    const conversation = this.conversations.get(input.payload.id);
    if (!conversation) throw new ConversationNotFoundError(input.payload.id);
    const connection = this.connections.get(conversation.connectionId);
    if (!connection) throw new ConnectionUnavailableError(input.payload.id);

    if (input.operation === 'send_message') {
      conversation.history = [
        ...conversation.history,
        { id: randomUUID(), role: 'human', text: input.payload.message, createdAt: new Date().toISOString() },
      ];
      this.emit('conversation-updated', conversation);
    }

    const command = { type: 'command' as const, requestId: randomUUID(), ...input };
    connection.send(JSON.stringify(command));
  }
}
```

- [ ] **Step 4: Apagar o `SessionStore` antigo**

```bash
rm src/sessions/store.ts src/sessions/store.test.ts
rmdir src/sessions 2>/dev/null || true
```

- [ ] **Step 5: Rodar e confirmar que o novo teste passa**

```bash
npx tsx --test src/agent/hub.test.ts
```

- [ ] **Step 6: Atualizar o script `test`**

```json
"test": "tsx --test src/auth/password.test.ts src/auth/agentAuth.test.ts src/db/users.test.ts src/db/webSessions.test.ts src/db/agentTokens.test.ts src/agent/protocol.test.ts src/agent/hub.test.ts",
```

Repare que `src/sessions/store.test.ts` saiu da lista.

- [ ] **Step 7: `src/server.ts` ainda importa `SessionStore` — trocar por `AgentHub` provisoriamente**

Editar `src/server.ts`: trocar

```ts
import { SessionStore } from './sessions/store.js';
...
const store = new SessionStore();
```

por

```ts
import { AgentHub } from './agent/hub.js';
...
const hub = new AgentHub();
```

E trocar `createWebRouter(store)` por `createWebRouter(hub as any)` **temporariamente** — a Task 8 corrige a assinatura de `createWebRouter` pra receber `AgentHub` de verdade. Remover também a linha `setInterval(() => store.sweepStaleSessions(...))` e sua constante `STALE_SESSION_MS` (o `AgentHub` não precisa de sweep: a conexão WS já avisa de queda via evento `close`, ao contrário do modelo antigo baseado em heartbeat HTTP).

```bash
npm run build
```

Esperado: ainda compila (com o `as any` temporário). Isso é só uma ponte até a Task 8/9 recablearem `server.ts` de vez — não commitar código de produção final aqui, é um estado intermediário de uma mesma sessão de implementação.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: adicionar AgentHub em memória, substituindo o SessionStore de MCP"
```

---

## Task 6: Servidor WebSocket (`src/agent/wsServer.ts`)

**Files:**
- Create: `src/agent/wsServer.ts`
- Create: `src/agent/wsServer.test.ts`
- Modify: `package.json` (dependências e script `test`)

**Interfaces:**
- Consumes: `AgentHub` (Task 5), `authenticateAgent` (Task 3), `wsInboundMessageSchema` (Task 4).
- Produces: `AGENT_WS_PATH` (string, `'/agent/ws'`), `attachAgentWsServer(httpServer, db, hub): WebSocketServer`.

- [ ] **Step 1: Instalar `ws`**

```bash
npm install ws
npm install -D @types/ws
```

- [ ] **Step 2: Escrever o teste**

`src/agent/wsServer.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { createDb } from '../db/index.js';
import { issueAgentToken } from '../db/agentTokens.js';
import { AgentHub } from './hub.js';
import { attachAgentWsServer, AGENT_WS_PATH } from './wsServer.js';

function startServer() {
  const db = createDb(':memory:');
  const hub = new AgentHub();
  const server = http.createServer();
  attachAgentWsServer(server, db, hub);
  return new Promise<{ db: ReturnType<typeof createDb>; hub: AgentHub; port: number; close: () => Promise<void> }>(
    (resolve) => {
      server.listen(0, () => {
        const { port } = server.address() as AddressInfo;
        resolve({ db, hub, port, close: () => new Promise((r) => server.close(() => r())) });
      });
    },
  );
}

function waitUntil(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error('timeout esperando condição'));
        return;
      }
      setTimeout(check, 10);
    };
    check();
  });
}

test('conexão sem token é recusada com 401', async () => {
  const { port, close } = await startServer();
  const ws = new WebSocket(`ws://localhost:${port}${AGENT_WS_PATH}`);

  await new Promise<void>((resolve) => {
    ws.on('unexpected-response', (_req, res) => {
      assert.equal(res.statusCode, 401);
      resolve();
    });
  });

  await close();
});

test('conexão autenticada registra a conversa aberta no hub', async () => {
  const { db, hub, port, close } = await startServer();
  const { secret } = issueAgentToken(db, 'user-1', 'teste');
  const ws = new WebSocket(`ws://localhost:${port}${AGENT_WS_PATH}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });

  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve());
    ws.on('error', reject);
  });

  ws.send(JSON.stringify({ type: 'event', event: 'conversation_opened', payload: { id: 'c1', title: 'Teste' } }));

  await waitUntil(() => hub.listConversations('user-1').length === 1);
  assert.equal(hub.listConversations('user-1')[0].id, 'c1');

  ws.close();
  await close();
});

test('hub.sendCommand entrega o comando pro socket certo', async () => {
  const { db, hub, port, close } = await startServer();
  const { secret } = issueAgentToken(db, 'user-1', 'teste');
  const ws = new WebSocket(`ws://localhost:${port}${AGENT_WS_PATH}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });

  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve());
    ws.on('error', reject);
  });
  ws.send(JSON.stringify({ type: 'event', event: 'conversation_opened', payload: { id: 'c1' } }));
  await waitUntil(() => hub.listConversations('user-1').length === 1);

  const received = new Promise<{ type: string; operation: string }>((resolve) => {
    ws.on('message', (raw) => resolve(JSON.parse(raw.toString())));
  });
  hub.sendCommand({ operation: 'stop_response', payload: { id: 'c1' } });

  const message = await received;
  assert.equal(message.type, 'command');
  assert.equal(message.operation, 'stop_response');

  ws.close();
  await close();
});
```

- [ ] **Step 3: Rodar e confirmar que falha**

```bash
npx tsx --test src/agent/wsServer.test.ts
```

- [ ] **Step 4: Implementar `src/agent/wsServer.ts`**

```ts
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
```

- [ ] **Step 5: Rodar de novo e confirmar que passa**

```bash
npx tsx --test src/agent/wsServer.test.ts
```

- [ ] **Step 6: Adicionar `ws` ao script `test` (não precisa — é dependência de runtime, não de teste) e adicionar o teste novo**

```json
"test": "tsx --test src/auth/password.test.ts src/auth/agentAuth.test.ts src/db/users.test.ts src/db/webSessions.test.ts src/db/agentTokens.test.ts src/agent/protocol.test.ts src/agent/hub.test.ts src/agent/wsServer.test.ts",
```

```bash
npm test
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: servidor WebSocket que autentica o vide-code e alimenta o AgentHub"
```

---

## Task 7: Rotas de gerenciamento de tokens

**Files:**
- Create: `src/web/tokenRoutes.ts`
- Create: `public/tokens.html`
- Create: `public/tokens.js`
- Modify: `src/server.ts` (montar o router — feito de fato na Task 9, aqui só criar o router)

**Interfaces:**
- Consumes: `issueAgentToken`, `listAgentTokens`, `revokeAgentToken` (Task 2), `requireWebAuthPage`/`requireWebAuthApi` (já existentes em `src/auth/webAuth.ts`).
- Produces: `createTokenRouter(db): Router` com `GET /tokens`, `GET /api/tokens`, `POST /api/tokens`, `DELETE /api/tokens/:id`.

Este projeto não tem testes automatizados de rota Express (convenção já existente — só lógica de dados/auth é testada com `node:test`; rotas são verificadas manualmente/via `npm run dev`). Este task segue essa mesma convenção.

- [ ] **Step 1: Implementar `src/web/tokenRoutes.ts`**

```ts
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
```

- [ ] **Step 2: Criar `public/tokens.html`**

```html
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>remote-controll — Tokens</title>
  <link rel="stylesheet" href="/style.css" />
</head>
<body>
  <header class="topbar">
    <h1><a href="/">&larr; Conversas</a></h1>
    <button id="logout" class="secondary">Sair</button>
  </header>
  <main class="page">
    <p>Cole o token gerado aqui na configuração do vide-code para conectar.</p>
    <div id="new-token"></div>
    <form id="create-form">
      <input id="label-input" type="text" placeholder="Nome (ex: notebook)" />
      <button type="submit">Gerar token</button>
    </form>
    <ul id="token-list" class="session-list"></ul>
  </main>
  <script src="/tokens.js"></script>
</body>
</html>
```

- [ ] **Step 3: Criar `public/tokens.js`**

```js
const list = document.getElementById('token-list');
const newTokenEl = document.getElementById('new-token');
const form = document.getElementById('create-form');
const labelInput = document.getElementById('label-input');

function render(tokens) {
  list.innerHTML = '';
  for (const token of tokens) {
    const li = document.createElement('li');
    const row = document.createElement('div');
    row.className = 'token-row';

    const label = document.createElement('span');
    label.textContent = `${token.label} — criado em ${new Date(token.createdAt).toLocaleString('pt-BR')}`;

    const revoke = document.createElement('button');
    revoke.textContent = 'Revogar';
    revoke.className = 'secondary';
    revoke.onclick = async () => {
      await fetch(`/api/tokens/${token.id}`, { method: 'DELETE' });
      load();
    };

    row.appendChild(label);
    row.appendChild(revoke);
    li.appendChild(row);
    list.appendChild(li);
  }
}

function load() {
  fetch('/api/tokens').then((r) => r.json()).then(render);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const label = labelInput.value.trim() || 'vide-code';
  const res = await fetch('/api/tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label }),
  });
  const created = await res.json();
  newTokenEl.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'auth-card';
  box.textContent = `Token gerado (copie agora, não será mostrado de novo): ${created.secret}`;
  newTokenEl.appendChild(box);
  labelInput.value = '';
  load();
});

load();

document.getElementById('logout').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login';
});
```

- [ ] **Step 4: Adicionar a classe `.token-row` no `public/style.css`**

```css
.token-row { display: flex; justify-content: space-between; align-items: center; padding: 0.9rem 1.1rem; gap: 0.75rem; }
```

- [ ] **Step 5: Commit**

```bash
git add src/web/tokenRoutes.ts public/tokens.html public/tokens.js public/style.css
git commit -m "feat: página e API de personal access tokens"
```

---

## Task 8: Rotas web de conversas (`src/web/routes.ts`)

**Files:**
- Modify: `src/web/routes.ts` (reescrita completa)

**Interfaces:**
- Consumes: `AgentHub`, `Conversation`, `ConversationNotFoundError`, `ConnectionUnavailableError` (Task 5).
- Produces: `createWebRouter(hub: AgentHub): Router` com `GET /`, `GET /conversations/:id`, `GET /api/conversations`, `GET /events`, `GET /api/conversations/:id`, `GET /conversations/:id/events`, `POST /api/conversations/:id/message`, `POST /api/conversations/:id/stop`, `POST /api/conversations/:id/answer`.

Mesma convenção da Task 7: sem teste automatizado de rota — verificado via `npm run dev` na Task 13.

- [ ] **Step 1: Reescrever `src/web/routes.ts`**

```ts
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
```

- [ ] **Step 2: Commit**

```bash
git add src/web/routes.ts
git commit -m "feat: rotas web de conversas sobre o AgentHub"
```

---

## Task 9: Recablear `src/server.ts` (HTTP + WS + rotas novas)

**Files:**
- Modify: `src/server.ts`

**Interfaces:**
- Consumes: `AgentHub` (Task 5), `attachAgentWsServer` (Task 6), `createTokenRouter` (Task 7), `createWebRouter(hub)` (Task 8).

- [ ] **Step 1: Reescrever `src/server.ts` por completo**

```ts
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb, defaultDbPath } from './db/index.js';
import { attachUser } from './auth/webAuth.js';
import { createAuthRouter } from './web/authRoutes.js';
import { createTokenRouter } from './web/tokenRoutes.js';
import { createWebRouter } from './web/routes.js';
import { AgentHub } from './agent/hub.js';
import { attachAgentWsServer } from './agent/wsServer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = createDb(defaultDbPath());
const hub = new AgentHub();
const app = express();

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});

app.use(attachUser(db));
app.use(createAuthRouter(db));
app.use(createTokenRouter(db));
app.use(createWebRouter(hub));
app.use(express.static(path.join(__dirname, '..', 'public'), { index: false }));

const httpServer = http.createServer(app);
attachAgentWsServer(httpServer, db, hub);

const port = Number(process.env.PORT) || 5002;
httpServer.listen(port, () => {
  console.log(`remote-controll ouvindo em http://localhost:${port}`);
});
```

- [ ] **Step 2: Confirmar que compila e sobe**

```bash
npm run build
npm run dev
```

Esperado: o processo sobe e loga `remote-controll ouvindo em http://localhost:5002`. Parar com Ctrl+C depois de confirmar.

- [ ] **Step 3: Rodar a suíte inteira de testes**

```bash
npm test
```

Esperado: todos os testes (`password`, `agentAuth`, `users`, `webSessions`, `agentTokens`, `protocol`, `hub`, `wsServer`) passam.

- [ ] **Step 4: Commit**

```bash
git add src/server.ts
git commit -m "feat: recablear server.ts para HTTP+WS com o AgentHub"
```

---

## Task 10: Lista de conversas abertas (página inicial)

**Files:**
- Modify: `public/index.html`
- Modify: `public/sessions.js`

**Interfaces:**
- Consumes: `GET /api/conversations`, SSE `GET /events` (evento `conversations`) — ambos da Task 8.

- [ ] **Step 1: Atualizar `public/index.html`**

```html
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>remote-controll — Conversas</title>
  <link rel="stylesheet" href="/style.css" />
</head>
<body>
  <header class="topbar">
    <h1>Conversas abertas</h1>
    <div>
      <a href="/tokens"><button class="secondary">Tokens</button></a>
      <button id="logout" class="secondary">Sair</button>
    </div>
  </header>
  <main class="page">
    <ul id="sessions" class="session-list"></ul>
    <p id="empty" hidden>Nenhuma conversa aberta no vide-code no momento.</p>
  </main>
  <script src="/sessions.js"></script>
</body>
</html>
```

- [ ] **Step 2: Atualizar `public/sessions.js`**

```js
const list = document.getElementById('sessions');
const empty = document.getElementById('empty');

function render(conversations) {
  list.innerHTML = '';
  empty.hidden = conversations.length > 0;
  for (const conversation of conversations) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = `/conversations/${conversation.id}`;

    const label = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = conversation.title || conversation.id;
    label.appendChild(name);

    const badge = document.createElement('span');
    badge.className = `badge badge-${conversation.status}`;
    badge.textContent = conversation.status;

    a.appendChild(label);
    a.appendChild(badge);
    li.appendChild(a);
    list.appendChild(li);
  }
}

fetch('/api/conversations').then((r) => r.json()).then(render);

const events = new EventSource('/events');
events.addEventListener('conversations', (event) => {
  render(JSON.parse(event.data));
});

document.getElementById('logout').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login';
});
```

- [ ] **Step 3: Adicionar os badges de status novos em `public/style.css`**

Adicionar, ao lado dos `.badge-*` já existentes:

```css
.badge-queued { background: #e0e7ff; color: #3730a3; }
.badge-streaming { background: #dbeafe; color: #1e40af; }
.badge-waiting_user { background: #fef3c7; color: #92400e; }
.badge-completed { background: #dcfce7; color: #166534; }
.badge-cancelled { background: #e5e7eb; color: #374151; }
.badge-error { background: #fee2e2; color: #991b1b; }
```

(`.badge-idle`, `.badge-waiting` e `.badge-disconnected` já existem; `.badge-waiting` fica sem uso agora e pode ser removida.)

- [ ] **Step 4: Commit**

```bash
git add public/index.html public/sessions.js public/style.css
git commit -m "feat: lista de conversas abertas com status do AgentHub"
```

---

## Task 11: Página de chat ao vivo (`conversation.html`/`conversation.js`)

**Files:**
- Create: `public/conversation.html` (substitui `public/session.html`)
- Create: `public/conversation.js` (substitui `public/chat.js`)
- Delete: `public/session.html`, `public/chat.js`
- Modify: `public/style.css`

**Interfaces:**
- Consumes: `GET /api/conversations/:id`, SSE `GET /conversations/:id/events` (evento `update`), `POST /api/conversations/:id/message`, `POST /api/conversations/:id/stop`, `POST /api/conversations/:id/answer` — todos da Task 8.

- [ ] **Step 1: Apagar os arquivos antigos**

```bash
rm public/session.html public/chat.js
```

- [ ] **Step 2: Criar `public/conversation.html`**

```html
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>remote-controll — Conversa</title>
  <link rel="stylesheet" href="/style.css" />
</head>
<body>
  <header class="topbar">
    <h1><a href="/">&larr; Conversas</a></h1>
    <button id="logout" class="secondary">Sair</button>
  </header>
  <main class="page">
    <div id="messages"></div>
    <div id="pending-question"></div>
    <div id="compose">
      <input id="message-input" type="text" placeholder="Mandar mensagem..." />
      <button id="send-btn">Enviar</button>
      <button id="stop-btn" class="secondary">Parar</button>
    </div>
  </main>
  <script src="/conversation.js"></script>
</body>
</html>
```

- [ ] **Step 3: Criar `public/conversation.js`**

```js
const conversationId = window.location.pathname.split('/').pop();
const messagesEl = document.getElementById('messages');
const pendingEl = document.getElementById('pending-question');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const stopBtn = document.getElementById('stop-btn');

const OTHER_VALUE = '__other__';

function renderEntry(prefix, text, className) {
  const div = document.createElement('div');
  div.className = `message ${className}`;
  const prefixEl = document.createElement('span');
  prefixEl.className = 'message-prefix';
  prefixEl.textContent = prefix;
  div.appendChild(prefixEl);
  div.appendChild(document.createTextNode(text));
  return div;
}

function renderConversation(conversation) {
  messagesEl.innerHTML = '';

  const feed = [
    ...conversation.history.map((h) => ({
      createdAt: h.createdAt,
      node: renderEntry(h.role === 'human' ? '[você] ' : '[agente] ', h.text, h.role === 'human' ? 'message-human' : 'message-agent'),
    })),
    ...conversation.activity.map((a) => ({
      createdAt: a.createdAt,
      node: renderEntry('', a.text, 'message-system'),
    })),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  for (const item of feed) messagesEl.appendChild(item.node);

  if (conversation.message && conversation.message.content) {
    messagesEl.appendChild(renderEntry('[agente] ', conversation.message.content, 'message-agent'));
  }

  messagesEl.scrollTop = messagesEl.scrollHeight;

  renderPendingQuestion(conversation);
  renderCompose(conversation);
}

function renderCompose(conversation) {
  const disconnected = conversation.status === 'disconnected';
  messageInput.disabled = disconnected;
  sendBtn.disabled = disconnected;
  stopBtn.disabled = disconnected || !['queued', 'streaming'].includes(conversation.status);
}

function renderPendingQuestion(conversation) {
  pendingEl.innerHTML = '';
  const pending = conversation.pendingQuestion;
  if (!pending || conversation.status === 'disconnected') return;

  const card = document.createElement('div');
  card.className = 'ask-user-card';

  for (const question of pending.questions) {
    const block = document.createElement('div');
    block.className = 'ask-user-question';
    block.dataset.questionId = question.id;

    const title = document.createElement('div');
    title.textContent = question.question;
    block.appendChild(title);

    const inputType = question.type === 'checkbox' ? 'checkbox' : 'radio';
    const defaults = Array.isArray(question.default) ? question.default.map(String) : [String(question.default)];
    const groupName = `q-${question.id}`;

    const list = document.createElement('div');
    list.className = 'options-list';
    for (const option of question.options) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = inputType;
      input.name = groupName;
      input.value = option.value;
      input.checked = defaults.includes(String(option.value));
      label.appendChild(input);
      label.appendChild(document.createTextNode(option.label));
      list.appendChild(label);
    }
    if (question.allowOther !== false) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = inputType;
      input.name = groupName;
      input.value = OTHER_VALUE;
      const otherText = document.createElement('input');
      otherText.type = 'text';
      otherText.placeholder = 'Outro...';
      otherText.disabled = true;
      input.addEventListener('change', () => {
        otherText.disabled = !input.checked;
      });
      label.appendChild(input);
      label.appendChild(otherText);
      list.appendChild(label);
    }
    block.appendChild(list);
    card.appendChild(block);
  }

  const submitBtn = document.createElement('button');
  submitBtn.textContent = 'Responder';
  submitBtn.onclick = () => submitAnswer(pending.questions, card, false);

  const skipBtn = document.createElement('button');
  skipBtn.textContent = 'Seguir sem mim';
  skipBtn.className = 'secondary';
  skipBtn.onclick = () => submitAnswer(pending.questions, card, true);

  card.appendChild(submitBtn);
  card.appendChild(skipBtn);
  pendingEl.appendChild(card);
}

async function submitAnswer(questions, card, skipped) {
  let answers;
  if (!skipped) {
    answers = {};
    for (const question of questions) {
      const block = card.querySelector(`[data-question-id="${question.id}"]`);
      const checkedValues = [...block.querySelectorAll('input:checked')].map((el) => el.value);
      const values = checkedValues.map((value) => {
        if (value !== OTHER_VALUE) return value;
        const otherInput = block.querySelector('input[type="text"]');
        return otherInput ? otherInput.value : '';
      });
      answers[question.id] = question.type === 'checkbox' ? values : values[0] ?? '';
    }
  }
  await fetch(`/api/conversations/${conversationId}/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ skipped, answers }),
  });
}

sendBtn.addEventListener('click', async () => {
  const message = messageInput.value.trim();
  if (!message) return;
  messageInput.value = '';
  await fetch(`/api/conversations/${conversationId}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
});

stopBtn.addEventListener('click', async () => {
  await fetch(`/api/conversations/${conversationId}/stop`, { method: 'POST' });
});

fetch(`/api/conversations/${conversationId}`)
  .then((r) => r.json())
  .then(renderConversation);

const events = new EventSource(`/conversations/${conversationId}/events`);
events.addEventListener('update', (event) => {
  renderConversation(JSON.parse(event.data));
});

document.getElementById('logout').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login';
});
```

- [ ] **Step 4: Adicionar CSS do card de `askUser` e da área de composição em `public/style.css`**

```css
#compose { display: flex; gap: 0.5rem; margin-top: 1rem; }
#compose input[type="text"] { flex: 1; padding: 0.55rem 0.75rem; border: 1px solid var(--color-border); border-radius: var(--radius); font-size: 0.95rem; }

.ask-user-card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius); box-shadow: var(--shadow); padding: 1rem; margin-top: 1rem; display: flex; flex-direction: column; gap: 0.75rem; }
.ask-user-question { display: flex; flex-direction: column; gap: 0.4rem; }
.ask-user-question .options-list input[type="text"] { margin-left: 0.5rem; padding: 0.3rem 0.5rem; border: 1px solid var(--color-border); border-radius: var(--radius); }
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: chat ao vivo com transcript, activity e card de askUser"
```

---

## Task 12: Cliente de teste (fake vide-code via WS)

**Files:**
- Create: `scripts/test-client.ts` (substitui o antigo, que falava MCP)

**Interfaces:**
- Consumes: o mesmo protocolo WS validado nas Tasks 4 e 6 — este script fala o lado "vide-code" do protocolo, então serve pra testar o `remote-controll` de ponta a ponta sem precisar do vide-code real.

- [ ] **Step 1: Criar `scripts/test-client.ts`**

```ts
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';

const baseUrl = process.env.REMOTE_CONTROLL_URL ?? 'http://localhost:5002';
const token = process.env.REMOTE_CONTROLL_TOKEN;

if (!token) {
  console.error('Defina REMOTE_CONTROLL_TOKEN (gere um token em /tokens) antes de rodar.');
  process.exit(1);
}

const wsUrl = `${baseUrl.replace(/^http/, 'ws')}/agent/ws`;
const ws = new WebSocket(wsUrl, { headers: { Authorization: `Bearer ${token}` } });
const conversationId = `fake-${randomUUID()}`;

function send(message: unknown): void {
  ws.send(JSON.stringify(message));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function simulateTurn(userMessage: string): Promise<void> {
  send({ type: 'event', event: 'snapshot', payload: { id: conversationId, status: 'queued' } });
  await delay(300);

  send({
    type: 'event',
    event: 'snapshot',
    payload: {
      id: conversationId,
      status: 'streaming',
      activity: [{ id: randomUUID(), kind: 'tool_call', text: 'Lendo arquivo fake.ts', createdAt: new Date().toISOString() }],
      message: { role: 'assistant', content: `Recebi: "${userMessage}"` },
    },
  });
  await delay(300);

  if (userMessage.toLowerCase().includes('pergunta')) {
    send({
      type: 'event',
      event: 'snapshot',
      payload: {
        id: conversationId,
        status: 'waiting_user',
        pendingQuestion: {
          messageId: `askuser-${randomUUID()}`,
          questions: [
            {
              id: 'cor',
              question: 'Qual cor você prefere?',
              type: 'radio',
              options: [
                { value: 'azul', label: 'Azul' },
                { value: 'verde', label: 'Verde' },
              ],
              default: 'azul',
            },
          ],
        },
      },
    });
    return;
  }

  send({
    type: 'event',
    event: 'snapshot',
    payload: {
      id: conversationId,
      status: 'completed',
      message: { role: 'assistant', content: `Recebi: "${userMessage}". Pronto.` },
    },
  });
}

ws.on('open', () => {
  console.log('Conectado ao remote-controll. Conversa fake:', conversationId);
  send({ type: 'event', event: 'conversation_opened', payload: { id: conversationId, title: 'Conversa de teste' } });
});

ws.on('message', (raw) => {
  const message = JSON.parse(raw.toString());
  console.log('Comando recebido:', message);
  if (message.type !== 'command') return;

  if (message.operation === 'send_message') {
    void simulateTurn(message.payload.message);
  } else if (message.operation === 'stop_response') {
    send({ type: 'event', event: 'snapshot', payload: { id: conversationId, status: 'cancelled' } });
  } else if (message.operation === 'answer_question') {
    console.log('Pergunta respondida:', message.payload);
    send({
      type: 'event',
      event: 'snapshot',
      payload: { id: conversationId, status: 'completed', message: { role: 'assistant', content: 'Obrigado pela resposta.' } },
    });
  }
});

ws.on('close', () => console.log('Conexão fechada.'));
ws.on('error', (err) => console.error('Erro na conexão:', err));
```

- [ ] **Step 2: Commit**

```bash
git add scripts/test-client.ts
git commit -m "feat: cliente de teste que simula o vide-code pelo protocolo WS"
```

---

## Task 13: Verificação final

**Files:** nenhum arquivo novo — só validação.

- [ ] **Step 1: Suíte completa**

```bash
npm test
npm run build
```

Esperado: todos os testes passam, `tsc -p .` compila sem erro.

- [ ] **Step 2: Fumaça manual do fluxo completo**

```bash
npm run dev
```

Em outro terminal, depois de criar uma conta em `http://localhost:5002/signup` e gerar um token em `http://localhost:5002/tokens`:

```bash
REMOTE_CONTROLL_TOKEN=<token gerado> npm run test:client
```

Verificar no navegador (`http://localhost:5002/`):
- A conversa fake aparece na lista com status atualizando ao vivo.
- Abrir a conversa mostra o histórico e a atividade (`Lendo arquivo fake.ts`) aparecendo.
- Mandar uma mensagem qualquer pela caixa de texto reflete no terminal do `test-client` (`Comando recebido: ...`) e a resposta simulada aparece no navegador.
- Mandar uma mensagem contendo a palavra "pergunta" dispara o card de `askUser`; respondê-lo (ou clicar "Seguir sem mim") libera a conversa de novo.
- Clicar "Parar" enquanto está `streaming` muda o status pra `cancelled`.

- [ ] **Step 3: Commit final (se algo precisar de ajuste dessa verificação)**

```bash
git add -A
git commit -m "chore: ajustes finais da verificação manual do espelho em tempo real"
```

(Só commitar se algo realmente mudou — se a verificação passar de primeira, não há o que commitar aqui.)

---

## Self-Review

**Cobertura do spec:** Login/signup mantidos (Task 1 não toca `authRoutes`/`webAuth`); personal access token (Task 2, 7); WS autenticado (Task 3, 6); protocolo `send_message`/`stop_response`/`answer_question` + eventos `conversation_opened`/`conversation_closed`/`snapshot` (Task 4, 6, 8); modelo de dados `Conversation`/`ActivityEntry`/`PendingQuestion` (Task 5); lista de conversas abertas (Task 10); chat ao vivo com activity + askUser (Task 11); remoção completa de OAuth/MCP (Task 1); script de teste manual (Task 12). Todos os itens do spec `2026-09-15-realtime-mirror-design.md` têm uma task correspondente.

**Placeholders:** nenhum "TBD"/"implementar depois" — toda task tem código completo ou comando exato.

**Consistência de tipos:** `AgentCommandInput`/`ConversationSnapshot` definidos na Task 4 são usados sem alteração de forma nas Tasks 5, 6, 8; `Conversation`/`HistoryEntry`/`ConversationNotFoundError`/`ConnectionUnavailableError` definidos na Task 5 são importados com os mesmos nomes nas Tasks 6, 8, 9; `AGENT_WS_PATH` definido na Task 6 é usado nos testes da própria Task 6 e implicitamente pelo vide-code (fora deste repo).

**Nota de design incorporada durante o planejamento (não estava explícita no spec):** o `Conversation` ganhou um campo `history` (turnos finalizados) além do `message` (turno em andamento) descrito no spec — isso não contradiz o spec, só o refina: sem isso, a UI perderia cada turno anterior assim que um novo começasse (o `message` é sobrescrito a cada turno, espelhando o snapshot do vide-code). `history` é derivado inteiramente pelo `AgentHub` a partir dos mesmos eventos do protocolo — não muda o contrato da mensagem WS em si.

---

**Plan complete and saved to `docs/superpowers/plans/2026-09-15-realtime-mirror.md`.** Duas opções de execução:

**1. Subagent-Driven (recomendado)** — eu despacho um subagente novo por task, com revisão entre elas, iteração rápida.

**2. Inline Execution** — executo as tasks nesta mesma sessão via `executing-plans`, em lote com checkpoints pra revisão.

Qual prefere?
