import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const baseUrl = process.env.MCP_BASE_URL ?? 'http://localhost:5002';
const tokenFile = path.join(__dirname, '.mcp-token.json');
const workspace = process.env.MCP_WORKSPACE ?? process.cwd();
const CALLBACK_PORT = 8765;
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}/callback`;

const toolName = process.argv[2];
const toolArg = process.argv[3] ?? 'Qual é a cor do céu?';
const optionsArg = process.argv[4];
const multipleArg = process.argv[5] === 'multiple';

// ask_human/confirm_action esperam o humano responder pelo chat, o que pode
// levar bem mais que o timeout padrão do SDK (60s) — usamos um timeout bem
// maior só para essas duas chamadas.
const HUMAN_RESPONSE_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const CALL_OPTIONS = {
  timeout: HUMAN_RESPONSE_TIMEOUT_MS,
  resetTimeoutOnProgress: true,
  maxTotalTimeout: HUMAN_RESPONSE_TIMEOUT_MS,
};

interface StoredTokens {
  clientId: string;
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
}

function loadTokens(): StoredTokens | undefined {
  if (!existsSync(tokenFile)) return undefined;
  try {
    return JSON.parse(readFileSync(tokenFile, 'utf8')) as StoredTokens;
  } catch {
    return undefined;
  }
}

function saveTokens(tokens: StoredTokens): void {
  writeFileSync(tokenFile, JSON.stringify(tokens, null, 2));
}

async function getOrRegisterClientId(): Promise<string> {
  const existing = loadTokens();
  if (existing?.clientId) return existing.clientId;
  const res = await fetch(`${baseUrl}/oauth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ redirect_uris: [REDIRECT_URI], client_name: 'test-client' }),
  });
  if (!res.ok) throw new Error(`Falha ao registrar client OAuth: ${await res.text()}`);
  const data = await res.json();
  return data.client_id as string;
}

function waitForCallback(): Promise<{ code: string; state: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', REDIRECT_URI);
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<p>Pode fechar esta aba e voltar pro terminal.</p>');
      server.close();
      if (error) {
        reject(new Error(`Autorização negada: ${error}`));
        return;
      }
      if (!code || !state) {
        reject(new Error('Callback OAuth sem code/state.'));
        return;
      }
      resolve({ code, state });
    });
    server.listen(CALLBACK_PORT);
  });
}

async function authorize(): Promise<StoredTokens> {
  const clientId = await getOrRegisterClientId();
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  const state = randomBytes(16).toString('hex');

  const authorizeUrl = new URL(`${baseUrl}/oauth/authorize`);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authorizeUrl.searchParams.set('code_challenge', codeChallenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  authorizeUrl.searchParams.set('state', state);

  console.log(`Abra esta URL pra autorizar o agente: ${authorizeUrl.toString()}`);
  const callbackPromise = waitForCallback();
  const { code, state: returnedState } = await callbackPromise;
  if (returnedState !== state) throw new Error('State do OAuth não confere — possível ataque, abortando.');

  const tokenRes = await fetch(`${baseUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      code_verifier: codeVerifier,
    }),
  });
  if (!tokenRes.ok) throw new Error(`Falha ao trocar o código por token: ${await tokenRes.text()}`);
  const tokenData = await tokenRes.json();
  const tokens: StoredTokens = {
    clientId,
    accessToken: tokenData.access_token,
    accessTokenExpiresAt: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
    refreshToken: tokenData.refresh_token,
  };
  saveTokens(tokens);
  console.log('Autorizado.');
  return tokens;
}

async function refresh(tokens: StoredTokens): Promise<StoredTokens> {
  const res = await fetch(`${baseUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
      client_id: tokens.clientId,
    }),
  });
  if (!res.ok) throw new Error('Refresh token inválido/expirado.');
  const data = await res.json();
  const updated: StoredTokens = {
    clientId: tokens.clientId,
    accessToken: data.access_token,
    accessTokenExpiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    refreshToken: data.refresh_token,
  };
  saveTokens(updated);
  return updated;
}

async function getValidTokens(): Promise<StoredTokens> {
  const existing = loadTokens();
  if (!existing) return authorize();
  if (new Date(existing.accessTokenExpiresAt).getTime() > Date.now() + 5000) return existing;
  try {
    return await refresh(existing);
  } catch {
    console.log('Refresh token expirado, autorizando de novo...');
    return authorize();
  }
}

function buildClient(accessToken: string): { client: Client; transport: StreamableHTTPClientTransport } {
  const client = new Client({ name: 'test-client', version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${accessToken}`, 'X-Workspace': workspace } },
  });
  return { client, transport };
}

async function main() {
  let tokens = await getValidTokens();
  let { client, transport } = buildClient(tokens.accessToken);

  try {
    await client.connect(transport);
  } catch {
    console.log('Token rejeitado pelo servidor, autorizando de novo...');
    tokens = await authorize();
    ({ client, transport } = buildClient(tokens.accessToken));
    await client.connect(transport);
  }

  const { tools } = await client.listTools();
  console.log('Tools disponíveis:', tools.map((t) => t.name).join(', '));

  if (toolName === 'ask_human') {
    const args: Record<string, unknown> = { question: toolArg };
    if (optionsArg) {
      args.options = optionsArg.split(',').map((s) => s.trim());
      args.multiple = multipleArg;
    }
    console.log(`Chamando ask_human — aguardando resposta pelo chat em ${baseUrl}/ ...`);
    const result = await client.callTool({ name: 'ask_human', arguments: args }, undefined, CALL_OPTIONS);
    console.log('Resposta recebida:', result.content);
  } else if (toolName === 'confirm_action') {
    console.log(`Chamando confirm_action — aguardando confirmação pelo chat em ${baseUrl}/ ...`);
    const result = await client.callTool(
      { name: 'confirm_action', arguments: { description: toolArg } },
      undefined,
      CALL_OPTIONS,
    );
    console.log('Resposta recebida:', result.content);
  }

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
