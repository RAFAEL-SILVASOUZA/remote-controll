# lib-ws-server
path: src/agent/wsServer.ts
files: src/agent/wsServer.ts, src/agent/wsServer.test.ts
lines: 178
deps: lib-agent-auth, lib-protocol, lib-hub
exports: AGENT_WS_PATH, attachAgentWsServer
does: Handles WebSocket upgrade at /agent/ws; authenticates, registers connection, dispatches events to hub
roles: n/a
db: n/a
links: lib-hub, lib-protocol, lib-agent-auth
