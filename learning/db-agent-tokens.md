# db-agent-tokens
path: src/db/agentTokens.ts
files: src/db/agentTokens.ts, src/db/agentTokens.test.ts
lines: 105
deps: node:sqlite, node:crypto
exports: AgentToken, issueAgentToken, findUserIdByAgentToken, listAgentTokens, revokeAgentToken
does: Personal access token lifecycle; stores SHA-256 hash, returns plaintext once at creation
roles: none
db: agent_tokens
links: db-index, lib-agent-auth, app-token-routes
