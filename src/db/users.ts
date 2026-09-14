import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: string;
}

export class EmailAlreadyRegisteredError extends Error {
  constructor(email: string) {
    super(`E-mail já cadastrado: ${email}`);
  }
}

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  created_at: string;
}

function toUser(row: UserRow): User {
  return { id: row.id, email: row.email, passwordHash: row.password_hash, createdAt: row.created_at };
}

export function createUser(db: DatabaseSync, email: string, passwordHash: string): User {
  if (findUserByEmail(db, email)) throw new EmailAlreadyRegisteredError(email);
  const user: User = { id: randomUUID(), email, passwordHash, createdAt: new Date().toISOString() };
  db.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    user.id,
    user.email,
    user.passwordHash,
    user.createdAt,
  );
  return user;
}

export function findUserByEmail(db: DatabaseSync, email: string): User | undefined {
  const row = db.prepare('SELECT id, email, password_hash, created_at FROM users WHERE email = ?').get(email) as
    | UserRow
    | undefined;
  return row ? toUser(row) : undefined;
}

export function findUserById(db: DatabaseSync, id: string): User | undefined {
  const row = db.prepare('SELECT id, email, password_hash, created_at FROM users WHERE id = ?').get(id) as
    | UserRow
    | undefined;
  return row ? toUser(row) : undefined;
}
