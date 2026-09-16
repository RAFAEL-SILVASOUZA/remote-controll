# Project Index
project: remote-controll
stack: Node.js 24, TypeScript, Express 5, ws, zod, node:sqlite, vanilla JS frontend
modules: 22
updated: 2026-09-16

## Modules
app-auth-routes.md | Login/signup/logout routes; serves HTML pages and handles POST /api/auth/* with zod validation
app-routes.md | Main web router: conversation list/detail pages, SSE streams, and command endpoints (send/stop/answer)
app-token-routes.md | Personal access token management: list, create (returns secret once), revoke; all API routes auth-guarded
comp-conversation.md | Live chat page: merged history+activity feed, pending-question cards, send/stop/answer, SSE updates
comp-login.md | Login form page; submits to POST /api/auth/login and redirects to ?next or /
comp-sessions.md | Home page: conversation list with status badges, live SSE updates, logout, link to /tokens
comp-signup.md | Signup form with client-side confirm check; maps error codes to PT-BR messages
comp-style.md | Shared stylesheet: topbar, auth cards, conversation list, status badges, message feed, ask-user cards
comp-tokens.md | Token management page: list, create (shows secret once), revoke, logout
db-agent-tokens.md | Personal access token lifecycle; stores SHA-256 hash, returns plaintext once at creation
db-index.md | Opens SQLite db and runs idempotent schema DDL for users, web_sessions, agent_tokens tables
db-users.md | CRUD for users table; email uniqueness enforced via UNIQUE constraint
db-web-sessions.md | Browser session lifecycle with 24h expiry; findUserIdByWebSession checks expires_at
lib-agent-auth.md | Bearer-token auth for vide-code agent WS handshake; resolves userId via token hash
lib-hub.md | In-memory state core tracking agent connections and conversations; emits SSE events
lib-password.md | scrypt password hashing with 16-byte salt and timingSafeEqual comparison
lib-protocol.md | Zod schemas defining the WS wire protocol between server and vide-code agent
lib-web-auth.md | Cookie-based browser session auth middleware; resolves req.userId from session cookie
lib-ws-server.md | Handles WebSocket upgrade at /agent/ws; authenticates, registers connection, dispatches events to hub
root-config.md | Project config: ESM TypeScript build, Docker multi-stage alpine, port 5002, SQLite volume
root-server.md | Wires Express app, AgentHub, WebSocket server; mounts all routers and static files
root-test-client.md | Fake vide-code agent that simulates WS conversation flow for manual end-to-end testing

## Quick Nav
app: app-auth-routes, app-routes, app-token-routes
db: db-index, db-users, db-web-sessions, db-agent-tokens
lib: lib-protocol, lib-hub, lib-ws-server, lib-web-auth, lib-agent-auth, lib-password
comp: comp-style, comp-login, comp-signup, comp-sessions, comp-conversation, comp-tokens
root: root-config, root-server, root-test-client
