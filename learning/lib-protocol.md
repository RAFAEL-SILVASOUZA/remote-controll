# lib-protocol
path: src/agent/protocol.ts
files: src/agent/protocol.ts, src/agent/protocol.test.ts
lines: 199
deps: zod (external)
exports: questionOptionSchema, userQuestionSchema, activityEntrySchema, pendingQuestionSchema, conversationStatusSchema, conversationSnapshotSchema, wsInboundMessageSchema, sendMessageCommandSchema, stopResponseCommandSchema, answerQuestionCommandSchema, QuestionOption, UserQuestion, ActivityEntry, PendingQuestion, ConversationStatus, ConversationSnapshot, WsInboundMessage, AgentCommandInput
does: Zod schemas defining the WS wire protocol between server and vide-code agent
roles: n/a
db: n/a
links: lib-hub, lib-ws-server
