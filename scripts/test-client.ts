import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const url = new URL(process.env.MCP_URL ?? 'http://localhost:5002/mcp');
const toolName = process.argv[2];
const toolArg = process.argv[3] ?? 'Qual é a cor do céu?';

async function main() {
  const client = new Client({ name: 'test-client', version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(url);
  await client.connect(transport);

  const { tools } = await client.listTools();
  console.log('Tools disponíveis:', tools.map((t) => t.name).join(', '));

  if (toolName === 'ask_human') {
    console.log(`Chamando ask_human("${toolArg}") — aguardando resposta pelo chat em http://localhost:5002/ ...`);
    const result = await client.callTool({ name: 'ask_human', arguments: { question: toolArg } });
    console.log('Resposta recebida:', result.content);
  } else if (toolName === 'confirm_action') {
    console.log(`Chamando confirm_action("${toolArg}") — aguardando confirmação pelo chat em http://localhost:5002/ ...`);
    const result = await client.callTool({ name: 'confirm_action', arguments: { description: toolArg } });
    console.log('Resposta recebida:', result.content);
  }

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
