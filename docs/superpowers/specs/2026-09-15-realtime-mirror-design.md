# Espelho em tempo real do vide-code — Design

**Data:** 2026-09-15
**Status:** Aprovado para implementação
**Contrato irmão:** `vide-code/docs/superpowers/specs/2026-09-15-remote-controll-integration-design.md` (mesmo protocolo, lado vide-code — implementado separadamente)

## Contexto

O `remote-controll` era um servidor MCP: um agente de IA genérico conectava via `/mcp` e usava tools (`ask_human`/`confirm_action`) pra perguntar coisas a um humano. Isso muda de estratégia por completo: agora existe um app específico do outro lado — o **vide-code** (extensão VS Code) — e o `remote-controll` vira o **espelho remoto em tempo real** dele.

Fluxo: o usuário loga no site, gera um **personal access token**, cola essa configuração no vide-code. A partir daí o vide-code (rodando localmente) abre uma conexão WebSocket de saída pro `remote-controll`, autenticada com esse token. O usuário então usa o site pra: ver a lista de conversas abertas no vide-code, acompanhar o chat rodando em tempo real (texto, atividade de tools, diffs), mandar mensagem numa conversa aberta, parar uma conversa, e responder `askUser`.

**Princípio central (herdado do contrato irmão): o vide-code é a fonte da verdade.** O remote-controll nunca fala com um model, tool runtime ou agent loop diretamente — ele só relê/aciona o que o vide-code já faz, através do canal WS.

## Objetivo

- Login/signup continuam existindo (já implementados) — sem mudança de comportamento.
- Uma página pra gerar/revogar um **personal access token** por usuário.
- `GET /` — lista as conversas abertas (de todas as conexões vide-code do usuário logado).
- `GET /conversations/:id` — chat ao vivo: histórico completo (texto + atividade de tools/diffs), input pra mandar mensagem, botão "Parar", card de `askUser` (múltiplas perguntas, radio/checkbox, "Outro", "Seguir sem mim") quando há pendência.
- Endpoint WS (`/agent/ws` ou path equivalente) onde o vide-code conecta, autenticado por Bearer token.

## Fora de escopo

- Servidor MCP (removido por completo — `src/mcp/`, dependência `@modelcontextprotocol/sdk`, OAuth 2.1 completo).
- Persistência de conversas depois de fechadas (mesma decisão do MVP anterior — em memória, sem histórico pós-desconexão).
- Múltiplos humanos por conversa.
- Criar conversa nova a partir do remote-controll (só age sobre conversas já abertas no vide-code).

## Stack

- Mantém: Node.js + TypeScript, Express, SQLite nativo (`node:sqlite`), `zod` (validação de payload do WS), `node:test`.
- Novo: pacote `ws` (WebSocket server) — substitui `@modelcontextprotocol/sdk`, que é **removido do `package.json`**.
- Frontend: mesmo padrão atual (HTML servido pelo backend + JS puro, SSE + `fetch`, sem build step). O componente de card de pergunta é reescrito pra suportar múltiplas perguntas (hoje só suporta uma lista de opções por pending request).

## Arquitetura

```
vide-code (N janelas) ──WS (Bearer token)──> AgentHub (remote-controll) ──SSE──> navegador
                        <── comandos ──                                <── HTTP (send/stop/answer) ──
```

Um único processo HTTP+WS (porta `5002`, configurável via `PORT`, igual hoje) expõe:

1. **`/agent/ws`** — upgrade de WebSocket. Cada conexão = uma instância/janela do vide-code, autenticada por Bearer token no handshake (`Authorization` ou querystring `?token=`, já que alguns clientes WS não enviam headers customizados com facilidade — decidir na implementação, mas preferir header). Uma conexão hospeda N conversas (`conversationId` por mensagem).
2. **UI web** — rotas Express que leem/escrevem no mesmo `AgentHub` (renomeação conceitual do `SessionStore` atual) que o WS usa.

O `AgentHub` (em memória) é o componente central: quando o vide-code manda um evento pelo WS, o hub atualiza o estado da conversa e emite pra SSE; quando o humano manda um comando pela UI, o hub resolve a conexão WS certa e envia o comando.

## Modelo de dados

```ts
type ConversationStatus =
  | 'idle' | 'queued' | 'streaming' | 'waiting_user'
  | 'completed' | 'cancelled' | 'error' | 'disconnected';

interface ActivityEntry {
  id: string;
  kind: 'tool_call' | 'tool_result' | 'diff' | 'info';
  text: string;
  createdAt: string;
}

interface UserQuestion {          // idêntico ao tipo do vide-code (src/interfaces/UserInteraction.ts)
  id: string;
  question: string;
  type: 'radio' | 'checkbox';
  options: { value: string; label: string; description?: string }[];
  default: string | string[];
  allowOther?: boolean;
}

interface PendingQuestion {
  messageId: string;
  questions: UserQuestion[];
}

interface Conversation {
  id: string;                     // conversationId real, vindo do vide-code
  connectionId: string;           // qual conexão WS (janela do vide-code) é dona
  userId: string;
  title?: string;
  status: ConversationStatus;
  message?: { role: 'assistant'; content: string };
  activity: ActivityEntry[];
  pendingQuestion?: PendingQuestion;
  error?: string;
  connectedAt: string;
  lastSeenAt: string;
}

interface AgentConnection {
  id: string;
  userId: string;
  connectedAt: string;
  conversationIds: Set<string>;
}
```

Isso substitui `Session`/`Message`/`PendingRequest` de `src/sessions/store.ts`. O `EventEmitter` interno continua (`sessions-changed` → renomeado `conversations-changed`; `session-message` → `conversation-updated`).

## Protocolo WS (idêntico ao contrato do lado vide-code)

Envelope:

```jsonc
// remote-controll -> vide-code
{ "type": "command", "requestId": "…", "operation": "send_message" | "stop_response" | "answer_question", "payload": { … } }

// vide-code -> remote-controll
{ "type": "result", "requestId": "…", "ok": true, "result": { /* Conversation snapshot */ } }
{ "type": "result", "requestId": "…", "ok": false, "error": "…" }
{ "type": "event", "event": "conversation_opened" | "conversation_closed" | "snapshot", "payload": { … } }
```

- **`send_message({ id, message })`** — enviado quando o humano manda mensagem pela UI numa conversa aberta. `id` sempre presente (nunca cria conversa nova).
- **`stop_response({ id })`** — botão "Parar".
- **`answer_question({ id, messageId, answers, skipped })`** — resposta do card de `askUser`. `answers` no shape `UserAnswers` (`Record<questionId, string | string[]>`).
- **`conversation_opened { id, title }`** / **`conversation_closed { id }`** — o hub cria/remove a `Conversation` e emite `conversations-changed`.
- **`snapshot { ...Conversation }`** — o hub substitui o estado da conversa (`status`, `message`, `activity`, `pendingQuestion`) e emite `conversation-updated`. **`activity` chega como array cumulativo completo a cada snapshot** (o vide-code acumula e reenvia tudo, não um delta) — o hub substitui `existing.activity` pelo array recebido, nunca concatena. Confirmado contra a implementação real do lado vide-code (`webview/remote-chat.js`, `cloneSnapshot`/`publish`), que reenvia o snapshot inteiro a cada mudança.

Todo payload recebido do WS é validado com `zod` antes de tocar o `AgentHub` — nunca confiar cegamente no que chega de uma conexão externa, mesmo autenticada.

## Auth

- **Mantém sem mudança:** `src/db/users.ts`, `src/db/webSessions.ts`, `src/auth/webAuth.ts`, `src/web/authRoutes.ts`, `public/login.html`/`signup.html` — login/signup no navegador continuam iguais.
- **Novo:** `src/db/agentTokens.ts` — personal access tokens, mesmo padrão de hash de `oauthTokens.ts` (`sha256`, tabela própria `agent_tokens(token_hash, user_id, label, created_at, last_used_at)`), sem TTL (revogável manualmente). Uma rota autenticada (`requireWebAuthPage`) pra gerar (mostra o token em texto puro uma única vez) e listar/revogar tokens.
- **Novo:** `src/auth/agentAuth.ts` — extrai Bearer do handshake do WS e resolve `userId` via `agentTokens`, reaproveitando o padrão de `mcpAuth.ts` (sem o header `WWW-Authenticate` específico de OAuth, que não se aplica mais).
- **Removido por completo:** `src/web/oauthRoutes.ts`, `src/db/oauthClients.ts` (+ teste), `src/db/oauthCodes.ts` (+ teste), `src/db/oauthTokens.ts` (+ teste), `src/auth/pkce.ts` (+ teste), `src/auth/mcpAuth.ts`, `public/authorize.html`, `public/authorize.js`, e as tabelas OAuth do schema em `src/db/index.ts`.
- **Removido:** `src/mcp/server.ts`, dependência `@modelcontextprotocol/sdk` do `package.json`.

## UI web

- `GET /` — lista conversas abertas do usuário (reaproveita `public/index.html`/`sessions.js`, troca "sessão" por "conversa").
- `GET /conversations/:id` — chat ao vivo (renomeia `session.html`/`chat.js`). Precisa de:
  - Renderização de `activity` (tool_call/tool_result/diff/info) intercalada com as mensagens, visualmente distinta do texto do assistente.
  - Input de texto + botão enviar → `POST /api/conversations/:id/message` → hub encaminha `send_message` pelo WS.
  - Botão "Parar" → `POST /api/conversations/:id/stop` → `stop_response`.
  - Card de `askUser`: **reescrito** — hoje `chat.js#renderReplyArea` só lida com uma pergunta e uma lista de opções; precisa suportar `questions[]` (até 4, radio/checkbox, "Outro" livre, default), próximo do que `vide-code/webview/question-card.js` já faz visualmente (mesma UX, reimplementada aqui do zero em JS puro — não há como compartilhar código entre os dois repos).
  - Botão "Seguir sem mim" além de "Responder", mapeando pra `answer_question({ skipped: true })`.
- Página de tokens (`GET /tokens`, ações via `POST /api/tokens`, `DELETE /api/tokens/:id`).

## Erros e casos de borda

- **Conexão WS do vide-code cai:** todas as conversas daquela `AgentConnection` viram `disconnected` (mensagem de sistema, igual ao `SessionStore` atual), e qualquer `pendingQuestion` fica visível mas não pode mais ser respondida (a UI mostra "Agente desconectado", replicando `renderReplyArea` atual).
- **Comando pra conversa sem conexão ativa (`send_message`/`stop_response`/`answer_question`):** `409` — não há WS aberto pra encaminhar.
- **Payload do WS fora do schema `zod`:** ignora a mensagem e loga aviso — não derruba a conexão nem propaga erro pro humano.
- **Token revogado com conexão WS aberta:** a implementação pode optar por deixar a conexão viva até cair naturalmente (mais simples) ou fechar ativamente ao revogar — decidir na implementação; documentar a escolha.
- **`answer_question` pra pergunta que já foi resolvida (ex.: respondida direto no VS Code enquanto a página remota estava aberta):** o próximo `snapshot` já chega sem `pendingQuestion`; a UI deve re-renderizar e descartar a resposta em trânsito sem erro visível.

## Testes

- `node:test` cobrindo `AgentHub`: criar/remover conversa, aplicar snapshot, marcar `disconnected` ao cair a conexão WS, rejeitar comando sem conexão ativa.
- `node:test` cobrindo `agentTokens.ts` (hash, geração, revogação) — mesmo padrão de `oauthTokens.test.ts`.
- Teste manual fim a fim: script de teste (substitui `scripts/test-client.ts`, que falava MCP) simulando uma conexão vide-code fake via WS — abre conversa, manda mensagens/activity, dispara uma pergunta `askUser` — pra validar o fluxo sem precisar do vide-code real rodando.

## Migração (resumo do que muda em disco)

**Removido:** `src/mcp/`, `src/auth/mcpAuth.ts`, `src/auth/pkce.ts(+test)`, `src/web/oauthRoutes.ts`, `src/db/oauthClients.ts(+test)`, `src/db/oauthCodes.ts(+test)`, `src/db/oauthTokens.ts(+test)`, `public/authorize.html`, `public/authorize.js`, dependência `@modelcontextprotocol/sdk`.

**Adicionado:** `src/agent/hub.ts` (renomeia/substitui `sessions/store.ts`), `src/agent/wsServer.ts`, `src/agent/protocol.ts` (schemas `zod` do envelope WS), `src/db/agentTokens.ts(+test)`, `src/auth/agentAuth.ts`, `src/web/tokenRoutes.ts`, `public/tokens.html`, dependência `ws`.

**Renomeado/adaptado:** `src/web/routes.ts` (rotas `/session*` → `/conversations*`), `public/index.html`/`sessions.js`, `public/session.html`/`chat.js` → `public/conversation.html`/`conversation.js`, `scripts/test-client.ts` (fala o protocolo WS novo em vez de MCP), `src/server.ts` (troca `app.listen` por `http.createServer(app)` + `WebSocketServer` anexado).
