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
  options?: string[];
  multiple?: boolean;
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

export interface PendingChoice {
  options?: string[];
  multiple?: boolean;
}

export interface PendingRequest extends PendingChoice {
  id: string;
  kind: PendingKind;
  resolve: (answer: PendingAnswer) => void;
  reject: (err: Error) => void;
}

export interface SessionSummary {
  id: string;
  clientName: string;
  userId: string;
  workspace: string;
  connectedAt: string;
  status: SessionStatus;
}

export interface Session extends SessionSummary {
  messages: Message[];
  pending?: PendingRequest;
  lastSeenAt: string;
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

export class InvalidAnswerError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export class SessionStore extends EventEmitter {
  private sessions = new Map<string, Session>();

  createSession(id: string, clientName: string, userId: string, workspace: string): Session {
    const now = new Date().toISOString();
    const session: Session = {
      id,
      clientName,
      userId,
      workspace,
      connectedAt: now,
      lastSeenAt: now,
      status: 'idle',
      messages: [],
    };
    this.sessions.set(id, session);
    this.emitSessionsChanged();
    return session;
  }

  /** Atualiza o "último visto" de uma sessão — chamar a cada request que chega por ela. */
  touchSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) session.lastSeenAt = new Date().toISOString();
  }

  removeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.disconnectSession(session, 'Agente desconectado.');
  }

  /**
   * Marca como desconectada qualquer sessão sem atividade (sem `touchSession`)
   * há mais de `maxIdleMs`. Cobre o caso de o agente cair sem fechar a
   * conexão de forma limpa (crash, queda de rede, processo morto).
   */
  sweepStaleSessions(maxIdleMs: number): void {
    const now = Date.now();
    for (const session of this.sessions.values()) {
      if (now - new Date(session.lastSeenAt).getTime() > maxIdleMs) {
        this.disconnectSession(session, 'Agente desconectado (sem atividade).');
      }
    }
  }

  /**
   * Sessões desconectadas não ficam de "histórico": o agente some da lista
   * assim que cai, em vez de acumular como card fantasma para sempre.
   */
  private disconnectSession(session: Session, message: string): void {
    if (session.pending) {
      session.pending.reject(new Error('Sessão desconectada antes de receber resposta.'));
      session.pending = undefined;
    }
    session.status = 'disconnected';
    this.addMessage(session.id, 'system', 'info', message);
    this.sessions.delete(session.id);
    this.emitSessionsChanged();
  }

  listSessions(userId: string): SessionSummary[] {
    return [...this.sessions.values()]
      .filter((s) => s.userId === userId)
      .map(({ id, clientName, userId: uid, workspace, connectedAt, status }) => ({
        id,
        clientName,
        userId: uid,
        workspace,
        connectedAt,
        status,
      }));
  }

  getSession(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  addMessage(
    sessionId: string,
    role: Role,
    kind: MessageKind,
    text: string,
    choice?: PendingChoice,
  ): Message {
    const session = this.sessions.get(sessionId);
    if (!session) throw new SessionNotFoundError(sessionId);
    const message: Message = {
      id: randomUUID(),
      role,
      kind,
      text,
      createdAt: new Date().toISOString(),
      options: choice?.options,
      multiple: choice?.multiple,
    };
    session.messages.push(message);
    this.emit('session-message', { sessionId, message });
    return message;
  }

  createPendingRequest(
    sessionId: string,
    kind: PendingKind,
    text: string,
    choice?: PendingChoice,
  ): Promise<PendingAnswer> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new SessionNotFoundError(sessionId);
    this.addMessage(sessionId, 'agent', kind === 'ask_human' ? 'question' : 'confirm', text, choice);
    session.status = 'waiting';
    this.emitSessionsChanged();
    return new Promise<PendingAnswer>((resolve, reject) => {
      session.pending = {
        id: randomUUID(),
        kind,
        options: choice?.options,
        multiple: choice?.multiple,
        resolve,
        reject,
      };
    });
  }

  resolvePendingRequest(sessionId: string, requestId: string, answer: PendingAnswer): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new SessionNotFoundError(sessionId);
    if (!session.pending || session.pending.id !== requestId) {
      throw new PendingMismatchError(sessionId, requestId);
    }
    const pending = session.pending;

    if (pending.kind === 'ask_human' && pending.options && pending.options.length > 0) {
      const text = (answer as AskHumanAnswer).text;
      const chosen = pending.multiple ? text.split(',').map((s) => s.trim()) : [text];
      const invalid = chosen.some((value) => !pending.options!.includes(value));
      if (chosen.length === 0 || invalid) {
        throw new InvalidAnswerError('Resposta não corresponde às opções oferecidas.');
      }
    }

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
    this.emit('sessions-changed');
  }
}
