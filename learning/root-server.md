# root-server
path: src/server.ts
files: src/server.ts
lines: 39
deps: db-index, lib-web-auth, app-auth-routes, app-token-routes, app-routes, lib-hub, lib-ws-server
exports: none (entry point)
does: Wires Express app, AgentHub, WebSocket server; mounts all routers and static files
roles: all (admin, user, agent)
db: none
links: root-config, lib-hub, lib-ws-server, app-routes, app-auth-routes, app-token-routes, lib-web-auth, db-index
