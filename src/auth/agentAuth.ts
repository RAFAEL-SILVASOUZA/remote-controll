import type { DatabaseSync } from 'node:sqlite';
import type { IncomingHttpHeaders } from 'node:http';
import { findUserIdByAgentToken } from '../db/agentTokens.js';

export function extractBearerToken(headers: IncomingHttpHeaders): string | undefined {
  const header = headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return undefined;
  return header.slice('Bearer '.length).trim();
}

export function authenticateAgent(db: DatabaseSync, headers: IncomingHttpHeaders): string | undefined {
  const token = extractBearerToken(headers);
  return token ? findUserIdByAgentToken(db, token) : undefined;
}
