import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function startFixture(port = 0) {
  const app = express();
  const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
  const clients = new Set();
  const commands = [];
  let rejectAnswer = false;
  let keepPending = false;
  const now = '2026-09-16T12:00:00.000Z';
  const state = {
    id: 'mobile-test', title: 'Revisão de responsividade do remote-controll', status: 'waiting_user',
    history: [{ id: 'human-1', role: 'human', text: 'Revise o projeto e mostre os resultados.', createdAt: now },
      { id: 'agent-1', role: 'assistant', text: '## Revisão do projeto\n\nA interface precisa continuar legível em telas pequenas.\n\n| Arquivo | Comportamento | Prioridade |\n| --- | --- | --- |\n| public/conversation.js | Preservar respostas durante atualizações | Alta |\n\n```js\nconst caminho = "' + 'diretorio/'.repeat(30) + 'arquivo.js";\n```', createdAt: now }],
    activity: [
      { id: 'task-list', kind: 'info', text: 'done:Ler o projeto\nin_progress:Revisar a experiência no celular', createdAt: now },
      { id: 'tool-1', kind: 'tool_result', text: 'File read public/conversation.js', subagent: { id: 'reviewer', name: 'Revisão da interface' }, createdAt: now },
    ],
    pendingQuestion: { messageId: 'question-1', questions: [
      { id: 'priority', question: 'Qual área você priorizaria para melhorar a experiência no celular?', type: 'radio', default: 'touch', allowOther: true, options: [
        { value: 'touch', label: 'Botões confortáveis para toque' }, { value: 'chat', label: 'Leitura e envio de mensagens' }, { value: 'forms', label: 'Formulários e navegação' },
      ] },
      { id: 'elements', question: 'Quais elementos devem ser verificados durante a revisão?', type: 'checkbox', default: ['table'], allowOther: true, options: [
        { value: 'table', label: 'Tabelas com várias colunas' }, { value: 'code', label: 'Blocos de código e caminhos longos' }, { value: 'agents', label: 'Atividades de ferramentas e subagentes' },
      ] },
    ] },
  };
  const emit = () => { for (const res of clients) res.write(`event: update\ndata: ${JSON.stringify(state)}\n\n`); };
  app.use(express.json());
  for (const [route, file] of Object.entries({ '/': 'index.html', '/login': 'login.html', '/signup': 'signup.html', '/tokens': 'tokens.html', '/conversations/mobile-test': 'conversation.html' })) {
    app.get(route, (_req, res) => res.sendFile(path.join(publicDir, file)));
  }
  app.get('/api/conversations', (_req, res) => res.json([state, { ...state, id: 'long-title', title: 'Projeto_com_nome_muito_longo_'.repeat(6), status: 'disconnected' }]));
  app.get('/api/conversations/mobile-test', (_req, res) => res.json(state));
  app.get('/api/tokens', (_req, res) => res.json([{ id: 'test-token', label: 'Notebook de desenvolvimento ' + 'nome-longo-'.repeat(8), createdAt: now }]));
  app.get('/events', (_req, res) => { res.setHeader('Content-Type', 'text/event-stream'); res.flushHeaders(); });
  app.get('/conversations/mobile-test/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream'); res.flushHeaders(); clients.add(res);
    req.on('close', () => clients.delete(res));
  });
  app.post('/api/conversations/mobile-test/:command', (req, res) => {
    if (req.params.command === 'answer' && rejectAnswer) return res.status(409).json({ error: 'connection_unavailable' });
    commands.push({ command: req.params.command, body: req.body });
    if (req.params.command === 'answer' && !keepPending) { state.pendingQuestion = undefined; state.status = 'idle'; }
    if (req.params.command === 'stop') state.status = 'cancelled';
    res.status(202).json({ ok: true }); emit();
  });
  app.use(express.static(publicDir));
  const server = await new Promise(resolve => { const s = app.listen(port, '127.0.0.1', () => resolve(s)); });
  return { state, emit, commands, keepQuestion: value => { keepPending = value; }, rejectAnswers: value => { rejectAnswer = value; }, url: `http://127.0.0.1:${server.address().port}`,
    close: () => { for (const res of clients) res.end(); server.closeAllConnections(); server.close(); } };
}

if (process.argv.includes('--serve')) {
  const fixture = await startFixture(5110);
  console.log(`Prévia com dados fictícios: ${fixture.url}`);
}
