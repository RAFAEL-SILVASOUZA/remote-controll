# remote-controll MCP — Design

**Data:** 2026-09-14
**Status:** Aprovado para implementação

## Contexto

Precisamos de um MCP server que funcione como ponte "humano no loop": um
agente de IA (cliente MCP, hoje rodando sobre o llama.cpp exposto em
`https://ai.rafael-silva-souza.dev/`) se conecta neste servidor e usa tools
para perguntar coisas ao humano ou pedir confirmação antes de agir. O humano
responde através de uma página web de chat.

O projeto vai rodar localmente na porta 5002 (`npm run dev`) durante a fase de
testes, exposto publicamente em `https://remote.rafael-silva-souza.dev/`
através do tunnel Cloudflare já existente ("Cloudflared",
`0db52881-4a55-4bf7-b1c1-2516364dd0e2`). Depois dos testes manuais, o projeto
será dockerizado (fora do escopo deste spec).

## Objetivo

- `GET /` — lista as sessões de agentes conectadas no momento (e seu status).
- `GET /session/:id` — abre o chat daquela sessão: histórico de
  perguntas/confirmações do agente e respostas do humano, atualizado em
  tempo real.
- `POST/GET/DELETE /mcp` — o servidor MCP de fato (Streamable HTTP), onde
  agentes se conectam como clientes MCP.

Fora de escopo neste MVP: autenticação, persistência entre reinícios,
Docker, múltiplos humanos por sessão, histórico após a sessão MCP fechar.

## Stack

- Node.js + TypeScript, processo único, Express.
- `@modelcontextprotocol/sdk` (SDK oficial), transporte Streamable HTTP.
- Frontend: HTML servido pelo backend + JS puro no browser, comunicação via
  Server-Sent Events (SSE) e `fetch`. Sem build step, sem framework de UI.
- Validação de input das tools via `zod`.
- Testes: `node:test` (nativo), sem framework externo.

## Arquitetura

Um único servidor HTTP (porta `5002`, configurável via `PORT`) expõe:

1. **`/mcp`** — endpoint MCP. Cada conexão de cliente cria uma sessão MCP
   (Streamable HTTP com header `Mcp-Session-Id`), gerenciada pelo SDK.
2. **UI web** — rotas Express que leem/escrevem no mesmo `SessionStore` que
   as tools do MCP usam.

O `SessionStore` (em memória, `Map`) é o componente central que conecta as
duas metades: quando uma tool MCP é chamada, ela grava uma mensagem no
store e cria uma "pending request" (uma Promise); quando o humano responde
pela UI, a rota HTTP resolve essa mesma Promise.

```
Agente MCP ──/mcp──> McpServer.tool(ask_human/confirm_action)
                              │
                              ▼
                        SessionStore (memória)
                         │             ▲
                    SSE (push)    POST /session/:id/reply
                         │             │
                         ▼             │
                    Browser (chat) ────┘
```

## Componentes

- **`src/mcp/server.ts`**
  Cria o `McpServer` do SDK, registra as tools:
  - `ask_human({ question: string, context?: string }) → string`
  - `confirm_action({ description: string, details?: string }) → { approved: boolean, comment?: string }`
  Cada chamada de tool: resolve/cria a sessão correspondente à conexão MCP
  atual, chama `store.createPendingRequest(sessionId, kind, payload)` e
  `await`a a Promise retornada como resultado da tool.

- **`src/sessions/store.ts`**
  `SessionStore`, com o shape de dados:
  ```ts
  type Session = {
    id: string;
    clientName: string;       // vindo do initialize do MCP, ou fallback genérico
    connectedAt: Date;
    status: 'idle' | 'waiting' | 'disconnected';
    messages: Message[];
  };

  type Message = {
    id: string;
    role: 'agent' | 'human' | 'system';
    kind: 'question' | 'confirm' | 'answer' | 'info';
    text: string;
    createdAt: Date;
  };
  ```
  Métodos: `createSession`, `removeSession` (ao fechar a conexão MCP —
  rejeita qualquer pending request daquela sessão e marca `disconnected`),
  `listSessions`, `addMessage`, `createPendingRequest(sessionId, kind,
  payload): Promise<Answer>`, `resolvePendingRequest(sessionId, requestId,
  answer)`. Emite eventos (`EventEmitter` interno) para as SSE: mudança na
  lista de sessões e nova mensagem numa sessão específica.

- **`src/web/routes.ts`**
  - `GET /` — página com a lista de sessões (renderizada no load + SSE
    `GET /events` para atualizar ao vivo).
  - `GET /session/:id` — página do chat (histórico inicial renderizado no
    load).
  - `GET /session/:id/events` — SSE com as mensagens/atualizações daquela
    sessão.
  - `POST /session/:id/reply` — body `{ requestId, text }` (para
    `ask_human`) ou `{ requestId, approved, comment? }` (para
    `confirm_action`). Resolve a pending request correspondente.

- **`public/`** — HTML estático mínimo + `sessions.js` e `chat.js` (vanilla,
  `EventSource` + `fetch`).

## Fluxo de dados (happy path)

1. Agente conecta em `/mcp` → `initialize` → sessão criada no
   `SessionStore` → evento de lista dispara → `/` atualiza via SSE.
2. Humano abre `/session/:id` → assina a SSE daquela sessão → recebe o
   histórico já existente (renderizado no load) + updates futuros.
3. Agente chama `ask_human({ question })`:
   - `SessionStore.addMessage` grava mensagem `kind: 'question'`.
   - Status da sessão vira `waiting`.
   - `createPendingRequest` cria a Promise que a tool vai `await`.
   - SSE notifica o chat aberto (nova mensagem) e a lista (`/`, mudança de
     status).
4. Humano responde no chat → `POST /session/:id/reply` → valida que
   `requestId` é o pending atual da sessão → `resolvePendingRequest` →
   grava mensagem `kind: 'answer'` → status volta a `idle` → SSE notifica.
5. A `await` na tool recebe o valor resolvido e retorna como resultado MCP
   pro agente.

`confirm_action` segue o mesmo fluxo, só troca o corpo da mensagem (texto +
botões Aceitar/Rejeitar em vez de um input de texto) e o payload do reply
(`approved`/`comment` em vez de `text`).

## Erros e casos de borda

- **Conexão MCP cai com pending request aberta:** `removeSession` rejeita a
  Promise pendente (a tool call falha de volta pro agente com erro claro,
  em vez de ficar pendurada pra sempre) e marca a sessão `disconnected`;
  SSE avisa o chat aberto ("agente desconectado").
- **Reply com `requestId` que não é o pending atual** (aba antiga, duplo
  submit): responde `409 Conflict`, ignora.
- **Sessão inexistente** (`GET /session/:id` ou reply): `404`.
- **Input inválido nas tools:** validado por `zod` nos schemas das tools;
  o próprio SDK retorna erro MCP padrão pro agente.
- **Sem timeout:** por decisão explícita, `ask_human`/`confirm_action`
  esperam indefinidamente — não há timeout automático no MVP.
- **Sem autenticação:** risco aceito para a fase de testes locais/manuais.
  Antes de expor de forma mais permanente (ou ao dockerizar), revisitar —
  Cloudflare Access no hostname resolve sem mudar código da aplicação.

## Testes

- Testes automatizados (`node:test`) cobrindo a lógica concorrente do
  `SessionStore`: criar pending request, resolver, rejeitar ao remover
  sessão, rejeitar reply com `requestId` errado.
- Teste manual fim a fim (feito pelo usuário): conectar um client MCP de
  teste em `/mcp`, chamar `ask_human`/`confirm_action`, responder pelo
  chat, confirmar que o agente recebe a resposta.

## Deploy/exposição (fora do código)

Configurar no dashboard Cloudflare Zero Trust (Tunnels → "Cloudflared",
`0db52881-4a55-4bf7-b1c1-2516364dd0e2`) um Public Hostname:
`remote.rafael-silva-souza.dev` → `http://localhost:5002`, mesmo padrão
usado hoje para `ai.rafael-silva-souza.dev`.
