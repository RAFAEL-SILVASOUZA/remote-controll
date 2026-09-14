import { Router } from 'express';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';
import { registerClient, findClient } from '../db/oauthClients.js';
import { createAuthorizationCode, consumeAuthorizationCode } from '../db/oauthCodes.js';
import { issueTokens, rotateRefreshToken } from '../db/oauthTokens.js';
import { verifyPkce } from '../auth/pkce.js';
import { requireWebAuthPage, requireWebAuthApi } from '../auth/webAuth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', '..', 'public');

export function createOAuthRouter(db: DatabaseSync, publicBaseUrl: string): Router {
  const router = Router();

  router.get('/.well-known/oauth-protected-resource', (_req, res) => {
    res.json({
      resource: `${publicBaseUrl}/mcp`,
      authorization_servers: [publicBaseUrl],
    });
  });

  router.get('/.well-known/oauth-authorization-server', (_req, res) => {
    res.json({
      issuer: publicBaseUrl,
      authorization_endpoint: `${publicBaseUrl}/oauth/authorize`,
      token_endpoint: `${publicBaseUrl}/oauth/token`,
      registration_endpoint: `${publicBaseUrl}/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
    });
  });

  router.use(express.json());

  router.post('/oauth/register', (req, res) => {
    const redirectUris = req.body?.redirect_uris;
    if (
      !Array.isArray(redirectUris) ||
      redirectUris.length === 0 ||
      !redirectUris.every((u) => typeof u === 'string')
    ) {
      res.status(400).json({ error: 'invalid_client_metadata', error_description: 'redirect_uris é obrigatório.' });
      return;
    }
    const clientName = typeof req.body?.client_name === 'string' ? req.body.client_name : undefined;
    const client = registerClient(db, redirectUris, clientName);
    res.status(201).json({
      client_id: client.clientId,
      redirect_uris: client.redirectUris,
      client_name: client.clientName,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    });
  });

  router.get('/oauth/authorize', requireWebAuthPage, (req, res) => {
    const { client_id, redirect_uri } = req.query;
    if (typeof client_id !== 'string' || typeof redirect_uri !== 'string') {
      res.status(400).send('Requisição de autorização inválida.');
      return;
    }
    const client = findClient(db, client_id);
    if (!client || !client.redirectUris.includes(redirect_uri)) {
      res.status(400).send('Client ou redirect_uri desconhecido.');
      return;
    }
    res.sendFile(path.join(publicDir, 'authorize.html'));
  });

  router.get('/api/oauth/authorize/info', requireWebAuthApi, (req, res) => {
    const { client_id, redirect_uri } = req.query;
    if (typeof client_id !== 'string' || typeof redirect_uri !== 'string') {
      res.status(400).json({ error: 'invalid_request' });
      return;
    }
    const client = findClient(db, client_id);
    if (!client || !client.redirectUris.includes(redirect_uri)) {
      res.status(400).json({ error: 'invalid_request' });
      return;
    }
    res.json({ clientName: client.clientName ?? client.clientId, redirectUri: redirect_uri });
  });

  router.post('/api/oauth/authorize/decide', requireWebAuthApi, (req, res) => {
    const { decision, client_id, redirect_uri, code_challenge, code_challenge_method, state } = req.body ?? {};
    if (
      typeof client_id !== 'string' ||
      typeof redirect_uri !== 'string' ||
      typeof code_challenge !== 'string' ||
      typeof code_challenge_method !== 'string'
    ) {
      res.status(400).json({ error: 'invalid_request' });
      return;
    }
    const client = findClient(db, client_id);
    if (!client || !client.redirectUris.includes(redirect_uri)) {
      res.status(400).json({ error: 'invalid_request' });
      return;
    }

    const redirectUrl = new URL(redirect_uri);
    if (decision !== 'approve') {
      redirectUrl.searchParams.set('error', 'access_denied');
      if (typeof state === 'string') redirectUrl.searchParams.set('state', state);
      res.json({ redirectTo: redirectUrl.toString() });
      return;
    }

    const authCode = createAuthorizationCode(db, {
      clientId: client_id,
      userId: req.userId!,
      redirectUri: redirect_uri,
      codeChallenge: code_challenge,
      codeChallengeMethod: code_challenge_method,
    });
    redirectUrl.searchParams.set('code', authCode.code);
    if (typeof state === 'string') redirectUrl.searchParams.set('state', state);
    res.json({ redirectTo: redirectUrl.toString() });
  });

  router.post('/oauth/token', express.urlencoded({ extended: false }), (req, res) => {
    const grantType = req.body?.grant_type;
    try {
      if (grantType === 'authorization_code') {
        const { code, redirect_uri, client_id, code_verifier } = req.body ?? {};
        if (
          typeof code !== 'string' ||
          typeof redirect_uri !== 'string' ||
          typeof client_id !== 'string' ||
          typeof code_verifier !== 'string'
        ) {
          res.status(400).json({ error: 'invalid_request' });
          return;
        }
        const authCode = consumeAuthorizationCode(db, code);
        if (authCode.clientId !== client_id || authCode.redirectUri !== redirect_uri) {
          res.status(400).json({ error: 'invalid_grant' });
          return;
        }
        if (!verifyPkce(code_verifier, authCode.codeChallenge, authCode.codeChallengeMethod)) {
          res.status(400).json({ error: 'invalid_grant' });
          return;
        }
        const tokens = issueTokens(db, client_id, authCode.userId);
        res.json({
          access_token: tokens.accessToken,
          token_type: 'Bearer',
          expires_in: 3600,
          refresh_token: tokens.refreshToken,
        });
        return;
      }

      if (grantType === 'refresh_token') {
        const { refresh_token, client_id } = req.body ?? {};
        if (typeof refresh_token !== 'string' || typeof client_id !== 'string') {
          res.status(400).json({ error: 'invalid_request' });
          return;
        }
        const tokens = rotateRefreshToken(db, refresh_token, client_id);
        res.json({
          access_token: tokens.accessToken,
          token_type: 'Bearer',
          expires_in: 3600,
          refresh_token: tokens.refreshToken,
        });
        return;
      }

      res.status(400).json({ error: 'unsupported_grant_type' });
    } catch {
      res.status(400).json({ error: 'invalid_grant' });
    }
  });

  return router;
}
