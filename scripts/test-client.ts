import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const baseUrl = process.env.MCP_BASE_URL ?? 'http://localhost:5002';
const tokenFile = path.join(__dirname, '.mcp-token.json');
const workspace = process.env.MCP_WORKSPACE ?? process.cwd();

const toolName = process.argv[2];
const toolArg = process.argv[3] ?? 'Qual é a cor do céu?';
const optionsArg = process.argv[4];
const multipleArg = process.argv[5] === 'multiple';

const HUMAN_RESPONSE_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const CALL_OPTIONS = {
  timeout: HUMAN_RESPONSE_TIMEOUT_MS,
  resetTimeoutOnProgress: true,
  maxTotalTimeout: HUMAN_RESPONSE_TIMEOUT_MS,
};

function loadToken(): string | undefined {
  if (!existsSync(tokenFile)) return undefined;
  try {
    const data = JSON.parse(readFileSync(tokenFile, 'utf8'));
    if (data.expiresAt && new Date(data.expiresAt).getTime() > Date.now()) {
      return data.token;
    }
  } catch {
    // arquivo corrompido — ignora e pareia de novo
  }
  return undefined;
}

function saveToken(token: string, expiresAt: string): void {
  writeFileSync(tokenFile, JSON.stringify({ token, expiresAt }, null, 2));
}

async function pair(): Promise<string> {
  const startRes = await fetch(`${baseUrl}/api/mcp/pairing/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspace }),
  });
  const { code, verifyUrl } = await startRes.json();
  console.log(`Abra esta URL e aprove o agente: ${verifyUrl}`);

  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const pollRes = await fetch(`${baseUrl}/api/mcp/pairing/${code}`);
    if (!pollRes.ok) throw new Error('Pareamento expirou ou não existe mais.');
    const pairing = await pollRes.json();
    if (pairing.status === 'approved') {
      saveToken(pairing.token, pairing.expiresAt);
      console.log('Pareamento aprovado.');
      return pairing.token;
    }
    if (pairing.status === 'rejected') {
      throw new Error('Pareamento rejeitado.');
    }
    console.log('Ainda aguardando aprovação...');
  }
}

async function getToken(): Promise<string> {
  return loadToken() ?? pair();
}

function buildClient(token: string): { client: Client; transport: StreamableHTTPClientTransport } {
  const client = new Client({ name: 'test-client', version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}`, 'X-Workspace': workspace } },
  });
  return { client, transport };
}

async function main() {
  let token = await getToken();
  let { client, transport } = buildClient(token);

  try {
    await client.connect(transport);
  } catch {
    console.log('Token inválido/expirado, pareando de novo...');
    token = await pair();
    ({ client, transport } = buildClient(token));
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
