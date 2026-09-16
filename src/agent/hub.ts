import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { ActivityEntry, AgentCommandInput, ConversationSnapshot, ConversationStatus, PendingQuestion } from './protocol.js';

export interface HistoryEntry {
  id: string;
  role: 'human' | 'agent' | 'system';
  text: string;
  createdAt: string;
}

export interface Conversation {
  id: string;
  connectionId: string;
  userId: string;
  title?: string;
  status: ConversationStatus;
  message?: { role: 'assistant'; content: string };
  history: HistoryEntry[];
  activity: ActivityEntry[];
  pendingQuestion?: PendingQuestion;
  error?: string;
  connectedAt: string;
  lastSeenAt: string;
}

export interface AgentConnection {
  id: string;
  userId: string;
  connectedAt: string;
  conversationIds: Set<string>;
  send: (data: string) => void;
}

export class ConversationNotFoundError extends Error {
  constructor(id: string) {
    super(`Conversa não encontrada: ${id}`);
  }
}

export class ConnectionUnavailableError extends Error {
  constructor(id: string) {
    super(`Sem conexão ativa para a conversa: ${id}`);
  }
}

function isTerminal(status: ConversationStatus): boolean {
  return status === 'completed' || status === 'cancelled' || status === 'error';
}

export class AgentHub extends EventEmitter {
  private connections = new Map<string, AgentConnection>();
  private conversations = new Map<string, Conversation>();

  registerConnection(userId: string, send: (data: string) => void): AgentConnection {
    const connection: AgentConnection = {
      id: randomUUID(),
      userId,
      connectedAt: new Date().toISOString(),
      conversationIds: new Set(),
      send,
    };
    this.connections.set(connection.id, connection);
    return connection;
  }

  removeConnection(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (!connection) return;
    this.connections.delete(connectionId);
    for (const conversationId of connection.conversationIds) {
      const conversation = this.conversations.get(conversationId);
      if (!conversation) continue;
      conversation.status = 'disconnected';
      this.emit('conversation-updated', conversation);
    }
    this.emit('conversations-changed');
  }

  openConversation(connectionId: string, id: string, title?: string): Conversation {
    const connection = this.connections.get(connectionId);
    if (!connection) throw new ConnectionUnavailableError(connectionId);
    const now = new Date().toISOString();
    const conversation: Conversation = {
      id,
      connectionId,
      userId: connection.userId,
      title,
      status: 'idle',
      history: [],
      activity: [],
      connectedAt: now,
      lastSeenAt: now,
    };
    this.conversations.set(id, conversation);
    connection.conversationIds.add(id);
    this.emit('conversations-changed');
    return conversation;
  }

  closeConversation(id: string): void {
    const conversation = this.conversations.get(id);
    if (!conversation) return;
    this.connections.get(conversation.connectionId)?.conversationIds.delete(id);
    this.conversations.delete(id);
    this.emit('conversations-changed');
  }

  applySnapshot(id: string, snapshot: ConversationSnapshot): Conversation {
    const existing = this.conversations.get(id);
    if (!existing) throw new ConversationNotFoundError(id);

    const wasTerminal = isTerminal(existing.status);
    existing.title = snapshot.title ?? existing.title;
    existing.status = snapshot.status;
    existing.message = snapshot.message;
    if (snapshot.activity) {
      // O vide-code manda o array acumulado inteiro a cada snapshot, não um delta —
      // substituir aqui em vez de concatenar evita duplicar entradas já vistas.
      existing.activity = snapshot.activity;
    }
    existing.pendingQuestion = snapshot.pendingQuestion;
    existing.error = snapshot.error;
    existing.lastSeenAt = new Date().toISOString();

    if (!wasTerminal && isTerminal(snapshot.status) && existing.message) {
      existing.history = [
        ...existing.history,
        { id: randomUUID(), role: 'agent', text: existing.message.content, createdAt: existing.lastSeenAt },
      ];
      existing.message = undefined;
    }

    this.emit('conversation-updated', existing);
    return existing;
  }

  listConversations(userId: string): Conversation[] {
    return [...this.conversations.values()].filter((c) => c.userId === userId);
  }

  getConversation(id: string): Conversation | undefined {
    return this.conversations.get(id);
  }

  sendCommand(input: AgentCommandInput): void {
    const conversation = this.conversations.get(input.payload.id);
    if (!conversation) throw new ConversationNotFoundError(input.payload.id);
    const connection = this.connections.get(conversation.connectionId);
    if (!connection) throw new ConnectionUnavailableError(input.payload.id);

    if (input.operation === 'send_message') {
      conversation.history = [
        ...conversation.history,
        { id: randomUUID(), role: 'human', text: input.payload.message, createdAt: new Date().toISOString() },
      ];
      this.emit('conversation-updated', conversation);
    }

    const command = { type: 'command' as const, requestId: randomUUID(), ...input };
    connection.send(JSON.stringify(command));
  }
}
