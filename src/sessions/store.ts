import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

export type Role = 'agent' | 'human' | 'system';
export type MessageKind = 'question' | 'confirm' | 'answer' | 'info';

export interface Message {
  id: string;
  role: Role;
  kind: MessageKind;
  text: string;
  createdAt: string;
}

export type SessionStatus = 'idle' | 'waiting' | 'disconnected';
export type PendingKind = 'ask_human' | 'confirm_action';

export interface AskHumanAnswer {
  text: string;
}

export interface ConfirmActionAnswer {
  approved: boolean;
  comment?: string;
}

export type PendingAnswer = AskHumanAnswer | ConfirmActionAnswer;

export interface PendingRequest {
  id: string;
  kind: PendingKind;
  resolve: (answer: PendingAnswer) => void;
  reject: (err: Error) => void;
}

export interface SessionSummary {
  id: string;
  clientName: string;
  connectedAt: string;
  status: SessionStatus;
}

export interface Session extends SessionSummary {
  messages: Message[];
  pending?: PendingRequest;
}

export class SessionNotFoundError extends Error {
  constructor(sessionId: string) {
    super(`Sessão não encontrada: ${sessionId}`);
  }
}

export class PendingMismatchError extends Error {
  constructor(sessionId: string, requestId: string) {
    super(`Pending request não corresponde: sessão=${sessionId} requestId=${requestId}`);
  }
}

export class SessionStore extends EventEmitter {
  private sessions = new Map<string, Session>();

  createSession(id: string, clientName: string): Session {
    const session: Session = {
      id,
      clientName,
      connectedAt: new Date().toISOString(),
      status: 'idle',
      messages: [],
    };
    this.sessions.set(id, session);
    this.emitSessionsChanged();
    return session;
  }

  removeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (session.pending) {
      session.pending.reject(new Error('Sessão desconectada antes de receber resposta.'));
      session.pending = undefined;
    }
    session.status = 'disconnected';
    this.addMessage(sessionId, 'system', 'info', 'Agente desconectado.');
    this.emitSessionsChanged();
  }

  listSessions(): SessionSummary[] {
    return [...this.sessions.values()].map(({ id, clientName, connectedAt, status }) => ({
      id,
      clientName,
      connectedAt,
      status,
    }));
  }

  getSession(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  addMessage(sessionId: string, role: Role, kind: MessageKind, text: string): Message {
    const session = this.sessions.get(sessionId);
    if (!session) throw new SessionNotFoundError(sessionId);
    const message: Message = {
      id: randomUUID(),
      role,
      kind,
      text,
      createdAt: new Date().toISOString(),
    };
    session.messages.push(message);
    this.emit('session-message', { sessionId, message });
    return message;
  }

  createPendingRequest(sessionId: string, kind: PendingKind, text: string): Promise<PendingAnswer> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new SessionNotFoundError(sessionId);
    this.addMessage(sessionId, 'agent', kind === 'ask_human' ? 'question' : 'confirm', text);
    session.status = 'waiting';
    this.emitSessionsChanged();
    return new Promise<PendingAnswer>((resolve, reject) => {
      session.pending = { id: randomUUID(), kind, resolve, reject };
    });
  }

  resolvePendingRequest(sessionId: string, requestId: string, answer: PendingAnswer): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new SessionNotFoundError(sessionId);
    if (!session.pending || session.pending.id !== requestId) {
      throw new PendingMismatchError(sessionId, requestId);
    }
    const pending = session.pending;
    session.pending = undefined;
    session.status = 'idle';
    const text =
      pending.kind === 'ask_human'
        ? (answer as AskHumanAnswer).text
        : (answer as ConfirmActionAnswer).approved
          ? `Aprovado.${(answer as ConfirmActionAnswer).comment ? ` Comentário: ${(answer as ConfirmActionAnswer).comment}` : ''}`
          : `Rejeitado.${(answer as ConfirmActionAnswer).comment ? ` Motivo: ${(answer as ConfirmActionAnswer).comment}` : ''}`;
    this.addMessage(sessionId, 'human', 'answer', text);
    pending.resolve(answer);
    this.emitSessionsChanged();
  }

  private emitSessionsChanged(): void {
    this.emit('sessions-changed', this.listSessions());
  }
}
