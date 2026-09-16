# lib-agent-auth
path: src/auth/agentAuth.ts
files: src/auth/agentAuth.ts, src/auth/agentAuth.test.ts
lines: 44
deps: db-agent-tokens
exports: extractBearerToken, authenticateAgent
does: Bearer-token auth for vide-code agent WS handshake; resolves userId via token hash
roles: agent (vide-code)
db: agent_tokens
links: db-agent-tokens, lib-ws-server
