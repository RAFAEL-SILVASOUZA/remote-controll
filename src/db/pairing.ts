import type { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { createToken } from './tokens.js';

const PAIRING_TTL_MS = 10 * 60 * 1000;

export type PairingStatus = 'pending' | 'approved' | 'rejected';

export interface PairingRequest {
  code: string;
  status: PairingStatus;
  userId?: string;
  token?: string;
  workspace?: string;
  createdAt: string;
  expiresAt: string;
}

interface PairingRow {
  code: string;
  status: PairingStatus;
  user_id: string | null;
  token: string | null;
  workspace: string | null;
  created_at: string;
  expires_at: string;
}

function toPairing(row: PairingRow): PairingRequest {
  return {
    code: row.code,
    status: row.status,
    userId: row.user_id ?? undefined,
    token: row.token ?? undefined,
    workspace: row.workspace ?? undefined,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export class PairingNotPendingError extends Error {
  constructor(code: string) {
    super(`Pairing não está pendente: ${code}`);
  }
}

export function createPairing(db: DatabaseSync, workspace: string | undefined): PairingRequest {
  const code = randomBytes(16).toString('hex');
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + PAIRING_TTL_MS);
  db.prepare(
    'INSERT INTO pairing_requests (code, status, workspace, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
  ).run(code, 'pending', workspace ?? null, createdAt.toISOString(), expiresAt.toISOString());
  return {
    code,
    status: 'pending',
    workspace,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}

export function getPairing(db: DatabaseSync, code: string): PairingRequest | undefined {
  const row = db.prepare('SELECT * FROM pairing_requests WHERE code = ?').get(code) as PairingRow | undefined;
  return row ? toPairing(row) : undefined;
}

export function isPairingExpired(pairing: PairingRequest): boolean {
  return new Date(pairing.expiresAt).getTime() <= Date.now();
}

export function approvePairing(db: DatabaseSync, code: string, userId: string): PairingRequest {
  const pairing = getPairing(db, code);
  if (!pairing || pairing.status !== 'pending' || isPairingExpired(pairing)) {
    throw new PairingNotPendingError(code);
  }
  const { token } = createToken(db, userId);
  db.prepare('UPDATE pairing_requests SET status = ?, user_id = ?, token = ? WHERE code = ?').run(
    'approved',
    userId,
    token,
    code,
  );
  return { ...pairing, status: 'approved', userId, token };
}

export function rejectPairing(db: DatabaseSync, code: string): PairingRequest {
  const pairing = getPairing(db, code);
  if (!pairing || pairing.status !== 'pending' || isPairingExpired(pairing)) {
    throw new PairingNotPendingError(code);
  }
  db.prepare('UPDATE pairing_requests SET status = ? WHERE code = ?').run('rejected', code);
  return { ...pairing, status: 'rejected' };
}
