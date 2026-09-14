# remote-controll MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Node/TypeScript MCP server that lets a connected AI agent ask a human questions or request confirmation, mediated by a browser chat UI, running locally on port 5002 via `npm run dev`.

**Architecture:** One Express process exposes `/mcp` (MCP Streamable HTTP endpoint, via `@modelcontextprotocol/sdk`) and a small web UI (`/`, `/session/:id`, SSE endpoints, reply endpoint) that both read/write a shared in-memory `SessionStore`. Tool calls (`ask_human`, `confirm_action`) create a pending Promise in the store; the human's reply through the web UI resolves it.

**Tech Stack:** Node.js, TypeScript (`tsx` for dev, no build step needed for dev), Express, `@modelcontextprotocol/sdk`, `zod`, `node:test` for unit tests. Plain HTML + vanilla JS (EventSource/fetch) for the frontend.

**Spec:** `docs/superpowers/specs/2026-09-14-remote-mcp-design.md`

## Global Constraints

- No authentication in this MVP (accepted risk for the local testing phase — see spec's "Erros e casos de borda").
- No timeout on `ask_human`/`confirm_action` — they wait indefinitely until answered or the MCP connection closes.
- No persistence across restarts — everything lives in the `SessionStore` in-memory `Map`.
- Server listens on `PORT` env var, defaulting to `5002`.
- Frontend has no build step: plain HTML/CSS/JS served as static files from `public/`.

---

## Task 1: Project scaffolding + SessionStore (TDD)

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `src/sessions/store.ts`
- Test: `src/sessions/store.test.ts`

**Interfaces:**
- Produces (used by Task 2 and Task 3):
  - `class SessionStore extends EventEmitter`
  - `SessionStore#createSession(id: string, clientName: string): Session`
  - `SessionStore#removeSession(sessionId: string): void`
  - `SessionStore#listSessions(): SessionSummary[]`
  - `SessionStore#getSession(id: string): Session | undefined`
  - `SessionStore#addMessage(sessionId: string, role: Role, kind: MessageKind, text: string): Message`
  - `SessionStore#createPendingRequest(sessionId: string, kind: PendingKind, text: string): Promise<PendingAnswer>`
  - `SessionStore#resolvePendingRequest(sessionId: string, requestId: string, answer: PendingAnswer): void`
  - Events emitted: `'sessions-changed'` with `SessionSummary[]`; `'session-message'` with `{ sessionId: string; message: Message }`
  - Types: `Role`, `MessageKind`, `Message`, `SessionStatus`, `PendingKind`, `AskHumanAnswer`, `ConfirmActionAnswer`, `PendingAnswer`, `SessionSummary`, `Session`
  - Errors: `class SessionNotFoundError extends Error`, `class PendingMismatchError extends Error`

- [ ] **Step 1: Initialize the Node project and install dependencies**

Run:
```bash
npm init -y
npm install express zod @modelcontextprotocol/sdk
npm install -D typescript tsx @types/express @types/node
```

- [ ] **Step 2: Edit `package.json`**

`npm init -y` and the installs already wrote `name`, `version`, `dependencies`, and `devDependencies` with the real installed version numbers — leave those exactly as they are. Only add/change these three top-level fields:

```json
"type": "module",
"scripts": {
  "dev": "tsx watch src/server.ts",
  "build": "tsc -p .",
  "test": "tsx --test src/sessions/store.test.ts",
  "test:client": "tsx scripts/test-client.ts"
}
```

Add `"type": "module"` as a top-level field, and replace the auto-generated `"scripts"` object with the one above (keep `name`, `version`, `main`/other auto-generated fields, `dependencies`, `devDependencies` untouched).

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "."
  },
  "include": ["src", "scripts"]
}
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
dist/
```

- [ ] **Step 5: Write the failing test file `src/sessions/store.test.ts`**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionStore, PendingMismatchError, SessionNotFoundError } from './store.js';

test('createPendingRequest resolves via resolvePendingRequest with matching requestId', async () => {
  const store = new SessionStore();
  store.createSession('s1', 'Agente Teste');

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
  store.createSession('s2', 'Agente Teste');
  store.createPendingRequest('s2', 'ask_human', 'Pergunta');

  assert.throws(() => store.resolvePendingRequest('s2', 'id-errado', { text: 'x' }), PendingMismatchError);
});

test('resolvePendingRequest rejeita sessão inexistente', () => {
  const store = new SessionStore();
  assert.throws(() => store.resolvePendingRequest('nao-existe', 'qualquer', { text: 'x' }), SessionNotFoundError);
});

test('removeSession rejeita a pending request em aberto', async () => {
  const store = new SessionStore();
  store.createSession('s3', 'Agente Teste');
  const pendingPromise = store.createPendingRequest('s3', 'confirm_action', 'Confirma?');

  store.removeSession('s3');

  await assert.rejects(pendingPromise, /desconectada/);
  assert.equal(store.getSession('s3')?.status, 'disconnected');
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './store.js'` (or similar), because `src/sessions/store.ts` doesn't exist yet.

- [ ] **Step 7: Implement `src/sessions/store.ts`**

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

  createSession(id: string, clientName: string): Session {
    const session: Session = {
      id,
      clientName,
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

  listSessions(): SessionSummary[] {
    return [...this.sessions.values()].map(({ id, clientName, connectedAt, status }) => ({
      id,
      clientName,
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
    this.emit('sessions-changed', this.listSessions());
  }
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all 4 tests green.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json tsconfig.json .gitignore src/sessions/store.ts src/sessions/store.test.ts
git commit -m "feat: scaffold project and add SessionStore"
```

---

## Task 2: MCP endpoint

**Files:**
- Create: `src/mcp/server.ts`
- Create: `src/server.ts`
- Create: `scripts/test-client.ts`

**Interfaces:**
- Consumes: `SessionStore` and its methods/types from Task 1 (`src/sessions/store.ts`).
- Produces (used by Task 3):
  - `createMcpRouter(store: SessionStore): express.Router` from `src/mcp/server.ts`, mounted at `/mcp`.
  - `src/server.ts` exports nothing (it's the app entrypoint), but Task 3 will modify it to also mount the web router and static files.

- [ ] **Step 1: Create `src/mcp/server.ts`**

```ts
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
```

- [ ] **Step 2: Create `src/server.ts`**

```ts
import express from 'express';
import { SessionStore } from './sessions/store.js';
import { createMcpRouter } from './mcp/server.js';

const store = new SessionStore();
const app = express();

app.use('/mcp', createMcpRouter(store));

const port = Number(process.env.PORT) || 5002;
app.listen(port, () => {
  console.log(`remote-controll MCP ouvindo em http://localhost:${port}`);
});
```

- [ ] **Step 3: Create `scripts/test-client.ts`**

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const url = new URL(process.env.MCP_URL ?? 'http://localhost:5002/mcp');
const toolName = process.argv[2];
const toolArg = process.argv[3] ?? 'Qual é a cor do céu?';

async function main() {
  const client = new Client({ name: 'test-client', version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(url);
  await client.connect(transport);

  const { tools } = await client.listTools();
  console.log('Tools disponíveis:', tools.map((t) => t.name).join(', '));

  if (toolName === 'ask_human') {
    console.log(`Chamando ask_human("${toolArg}") — aguardando resposta pelo chat em http://localhost:5002/ ...`);
    const result = await client.callTool({ name: 'ask_human', arguments: { question: toolArg } });
    console.log('Resposta recebida:', result.content);
  } else if (toolName === 'confirm_action') {
    console.log(`Chamando confirm_action("${toolArg}") — aguardando confirmação pelo chat em http://localhost:5002/ ...`);
    const result = await client.callTool({ name: 'confirm_action', arguments: { description: toolArg } });
    console.log('Resposta recebida:', result.content);
  }

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 4: Verify tool registration end-to-end**

Run `npm run dev` in one terminal (leave it running). Expected log: `remote-controll MCP ouvindo em http://localhost:5002`.

In another terminal, run: `npm run test:client`
Expected output includes: `Tools disponíveis: ask_human, confirm_action`
(No tool is called yet, so the process exits cleanly without hanging.)

Stop the `npm run dev` process after verifying.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/server.ts src/server.ts scripts/test-client.ts
git commit -m "feat: add MCP endpoint with ask_human and confirm_action tools"
```

---

## Task 3: Web UI + full wiring + end-to-end smoke test

**Files:**
- Create: `public/style.css`
- Create: `public/index.html`
- Create: `public/sessions.js`
- Create: `public/session.html`
- Create: `public/chat.js`
- Create: `src/web/routes.ts`
- Modify: `src/server.ts` (mount web router + static files)

**Interfaces:**
- Consumes: `SessionStore` from Task 1 (`getSession`, `listSessions`, `resolvePendingRequest`, `SessionNotFoundError`, `PendingMismatchError`, events `'sessions-changed'`/`'session-message'`); `createMcpRouter` from Task 2.
- Produces: `createWebRouter(store: SessionStore): express.Router` from `src/web/routes.ts`, mounted at the app root.

- [ ] **Step 1: Create `public/style.css`**

```css
body { font-family: system-ui, sans-serif; max-width: 640px; margin: 2rem auto; padding: 0 1rem; }
#messages { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 1rem; }
.message { padding: 0.5rem; border-radius: 0.5rem; background: #f0f0f0; }
.message-human { background: #d7e9ff; align-self: flex-end; }
.message-system { background: #ffe0e0; font-style: italic; }
.error { color: #c00; margin-top: 0.5rem; }
#reply-area { display: flex; gap: 0.5rem; }
```

- [ ] **Step 2: Create `public/index.html`**

```html
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>remote-controll — Sessões</title>
  <link rel="stylesheet" href="/style.css" />
</head>
<body>
  <h1>Sessões conectadas</h1>
  <ul id="sessions"></ul>
  <p id="empty" hidden>Nenhum agente conectado ainda.</p>
  <script src="/sessions.js"></script>
</body>
</html>
```

- [ ] **Step 3: Create `public/sessions.js`**

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
    a.textContent = `${session.clientName} — ${session.status}`;
    li.appendChild(a);
    list.appendChild(li);
  }
}

fetch('/api/sessions').then((r) => r.json()).then(render);

const events = new EventSource('/events');
events.addEventListener('sessions', (event) => {
  render(JSON.parse(event.data));
});
```

- [ ] **Step 4: Create `public/session.html`**

```html
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>remote-controll — Chat</title>
  <link rel="stylesheet" href="/style.css" />
</head>
<body>
  <p><a href="/">&larr; Sessões</a></p>
  <div id="messages"></div>
  <div id="reply-area"></div>
  <script src="/chat.js"></script>
</body>
</html>
```

- [ ] **Step 5: Create `public/chat.js`**

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

  if (session.pending.kind === 'ask_human') {
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Digite sua resposta...';
    const button = document.createElement('button');
    button.textContent = 'Enviar';
    button.onclick = () => sendReply({ requestId: session.pending.id, text: input.value });
    replyArea.appendChild(input);
    replyArea.appendChild(button);
  } else {
    const approve = document.createElement('button');
    approve.textContent = 'Aprovar';
    approve.onclick = () => sendReply({ requestId: session.pending.id, approved: true });
    const reject = document.createElement('button');
    reject.textContent = 'Rejeitar';
    reject.onclick = () => sendReply({ requestId: session.pending.id, approved: false });
    replyArea.appendChild(approve);
    replyArea.appendChild(reject);
  }
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

- [ ] **Step 6: Create `src/web/routes.ts`**

```ts
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
```

- [ ] **Step 7: Update `src/server.ts` to mount the web router and static files**

Replace the full contents of `src/server.ts` with:

```ts
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SessionStore } from './sessions/store.js';
import { createMcpRouter } from './mcp/server.js';
import { createWebRouter } from './web/routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const store = new SessionStore();
const app = express();

app.use('/mcp', createMcpRouter(store));
app.use(createWebRouter(store));
app.use(express.static(path.join(__dirname, '..', 'public')));

const port = Number(process.env.PORT) || 5002;
app.listen(port, () => {
  console.log(`remote-controll MCP ouvindo em http://localhost:${port}`);
});
```

- [ ] **Step 8: Verify the empty UI loads**

Run `npm run dev`. Open `http://localhost:5002/` in a browser.
Expected: page loads, shows "Sessões conectadas" and "Nenhum agente conectado ainda." with no console errors.

- [ ] **Step 9: Verify the full `ask_human` round trip**

With `npm run dev` still running, in another terminal run:
```bash
npm run test:client -- ask_human "Qual é a cor do céu?"
```
Expected: it prints `Tools disponíveis: ask_human, confirm_action` then hangs on "Chamando ask_human...".

In the browser, refresh `http://localhost:5002/` — a new session should appear. Click it, see the question message. Type an answer (e.g. "Azul") and click "Enviar".

Expected: the `test:client` terminal prints `Resposta recebida:` followed by content containing `"text": "Azul"`, then the process exits with code 0. The browser chat shows the human's answer appended and "Sem perguntas pendentes." in the reply area.

- [ ] **Step 10: Verify the full `confirm_action` round trip**

Run:
```bash
npm run test:client -- confirm_action "Deletar arquivo de teste?"
```
In the browser, open the new session, click "Aprovar".
Expected: `test:client` terminal prints `Resposta recebida:` containing `"Aprovado."`, exits 0.

Stop the `npm run dev` process after verifying.

- [ ] **Step 11: Commit**

```bash
git add public src/web/routes.ts src/server.ts
git commit -m "feat: add sessions/chat web UI wired to the SessionStore"
```
