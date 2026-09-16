# app-token-routes
path: src/web/tokenRoutes.ts
files: src/web/tokenRoutes.ts
lines: 41
deps: db-agent-tokens, lib-web-auth
exports: createTokenRouter
does: Personal access token management: list, create (returns secret once), revoke; all API routes auth-guarded
roles: all (browser users)
db: agent_tokens
links: db-agent-tokens, lib-web-auth, comp-tokens
