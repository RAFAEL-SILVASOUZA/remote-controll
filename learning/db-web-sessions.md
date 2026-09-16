# db-web-sessions
path: src/db/webSessions.ts
files: src/db/webSessions.ts, src/db/webSessions.test.ts
lines: 52
deps: node:sqlite
exports: createWebSession, findUserIdByWebSession, deleteWebSession
does: Browser session lifecycle with 24h expiry; findUserIdByWebSession checks expires_at
roles: none
db: web_sessions
links: db-index, lib-web-auth, app-auth-routes
