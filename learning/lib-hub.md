# lib-hub
path: src/agent/hub.ts
files: src/agent/hub.ts, src/agent/hub.test.ts
lines: 309
deps: lib-protocol
exports: AgentHub, ConversationNotFoundError, ConnectionUnavailableError, HistoryEntry, Conversation, AgentConnection
does: In-memory state core tracking agent connections and conversations; emits SSE events
roles: n/a
db: n/a
links: lib-protocol, lib-ws-server, app-routes
