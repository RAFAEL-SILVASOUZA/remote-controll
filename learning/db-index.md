# db-index
path: src/db/index.ts
files: src/db/index.ts
lines: 39
deps: node:sqlite
exports: createDb, defaultDbPath
does: Opens SQLite db and runs idempotent schema DDL for users, web_sessions, agent_tokens tables
roles: none
db: users, web_sessions, agent_tokens
links: db-users, db-web-sessions, db-agent-tokens, root-server
