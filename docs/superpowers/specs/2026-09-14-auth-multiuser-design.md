# remote-controll — Autenticação, multiusuário, tools de escolha e redesign — Design

**Data:** 2026-09-14
**Status:** Aprovado para implementação

## Contexto

O MVP anterior (`docs/superpowers/specs/2026-09-14-remote-mcp-design.md`) não
tinha autenticação: qualquer agente conectava em `/mcp` e qualquer visitante
via todas as sessões em `/`. Agora que o projeto vai ser usado de verdade,
precisamos de:

- Cada humano ter sua própria conta e só ver as próprias sessões.
- O agente MCP se autenticar sozinho (sem o humano digitar nada no agente),
  através de um fluxo de pareamento que passa pela tela de login.
- Perguntas de escolha única/múltipla (`ask_human` com radio/checkbox), não só
  texto livre.
- Capturar o workspace do agente conectado, pra o humano distinguir suas
  próprias sessões na lista.
- Uma cara visual mais "enterprise" nas páginas existentes e novas.

Persistência: SQLite via `node:sqlite` (nativo do Node 24, confirmado
funcionando nesta máquina — sem dependência nativa extra tipo
`better-sqlite3`).

## Modelo de dados

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE mcp_tokens (
  token_hash TEXT PRIMARY KEY,     -- sha256(token) — o token em texto puro nunca é persistido aqui
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL         -- created_at + 5 dias
);

CREATE TABLE pairing_requests (
  code TEXT PRIMARY KEY,           -- 32 hex chars aleatórios (crypto.randomBytes(16))
  status TEXT NOT NULL,            -- 'pending' | 'approved' | 'rejected'
  user_id TEXT,                    -- setado quando aprovado
  token TEXT,                      -- token em texto puro, setado quando aprovado (linha de vida curta)
  workspace TEXT,                  -- workspace informado pelo agente ao iniciar o pareamento
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL         -- created_at + 10 minutos
);

CREATE TABLE web_sessions (
  id TEXT PRIMARY KEY,             -- valor do cookie
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL         -- created_at + 24h (limite de higiene no servidor)
);
```

Senha: `scrypt` (nativo de `node:crypto`) + salt aleatório, formato
`salt_hex:hash_hex`. Sem dependência externa de hashing.

## Autenticação web (humano)

- `POST /api/auth/signup` `{ email, password, confirmPassword }`:
  valida e-mail (formato, via `zod` `.email()`), `password.length >= 8`,
  `password === confirmPassword`, e-mail ainda não cadastrado (409 se já
  existir). Cria o usuário, cria uma `web_sessions` e devolve o cookie de
  sessão. Já loga o usuário (sem etapa extra).
- `POST /api/auth/login` `{ email, password }`: valida credenciais, cria
  `web_sessions`, devolve cookie.
- `POST /api/auth/logout`: apaga a `web_sessions` atual, limpa o cookie.
- Cookie: `HttpOnly; Secure; SameSite=Lax`, **sem** `Max-Age`/`Expires` — é um
  cookie de sessão do navegador, então fecha o navegador e precisa logar de
  novo (é isso que você pediu: diferente do token do MCP, que persiste).
  Mesmo assim, o servidor limita a validade da linha em `web_sessions` a 24h
  como proteção extra caso a aba fique aberta por muito tempo.
- Páginas públicas: `GET /login`, `GET /signup`.
- Todo o resto (`/`, `/session/:id`, `/api/sessions`, `/api/session/:id`,
  SSE, reply) exige sessão web válida: página sem cookie válido → redirect
  pra `/login?next=<rota original>`; rota de API sem cookie válido → `401`.
- Os assets estáticos compartilhados (`/style.css`, `/*.js`) continuam
  públicos (senão a própria tela de login não carrega o CSS).

## Pareamento do agente MCP (device flow)

1. Agente sem token guardado chama `POST /api/mcp/pairing/start`
   (`{ workspace? }` no corpo, opcional). Servidor cria uma linha em
   `pairing_requests` (status `pending`, `expires_at` = +10min) e responde
   `{ code, verifyUrl }` (`verifyUrl` = `https://.../pair/<code>`).
2. O agente **imprime** essa `verifyUrl` — é isso que representa "o usuário é
   direcionado pra uma página de login": o humano que está configurando o
   agente abre esse link.
3. `GET /pair/:code` exige sessão web — sem login, redireciona pra
   `/login?next=/pair/:code`; depois do login, volta pra `/pair/:code`.
   Se o `code` não existe/expirou, mostra erro. Se existe e está `pending`,
   mostra o workspace informado e botões **Aprovar** / **Rejeitar**. Esse
   `workspace` do pairing é só informativo nessa tela (contexto pra quem vai
   aprovar) — o `workspace` que efetivamente fica salvo na sessão MCP é o do
   header `X-Workspace` enviado no passo 6, em cada conexão real a `/mcp`
   (podem ser conexões diferentes ao longo da vida do mesmo token).
4. `POST /api/mcp/pairing/:code/approve` (autenticado): gera um token opaco
   (32 bytes aleatórios), grava o hash em `mcp_tokens` com `user_id` atual e
   `expires_at` = +5 dias; atualiza a `pairing_requests` com
   `status='approved', user_id, token` (texto puro, mas a linha já expira em
   10 min de qualquer forma). `POST /api/mcp/pairing/:code/reject` marca
   `status='rejected'`.
5. Enquanto isso, o agente repete `GET /api/mcp/pairing/:code` a cada poucos
   segundos. Quando vê `status: 'approved'`, pega `{ token, expiresAt }` e
   salva localmente (no client de referência: arquivo `.mcp-token.json` ao
   lado do script). Se vir `'rejected'`, para de tentar e avisa o erro.
6. Toda chamada a `/mcp` (`POST`/`GET`/`DELETE`) passa por um middleware que
   exige `Authorization: Bearer <token>` válido (hash → lookup em
   `mcp_tokens` → checa `expires_at`). Sem token válido: `401`
   `{ error: 'authentication_required', pairingStartUrl: '/api/mcp/pairing/start' }`
   — o agente detecta esse 401 específico e reinicia o pareamento a partir do
   passo 1. Com token válido: middleware anexa `req.userId`, e o agente
   também deve enviar `X-Workspace: <workspace>` (mesma convenção do passo 1)
   em toda chamada — vira o `workspace` da sessão MCP criada no `initialize`.

## Sessões MCP por usuário e workspace

- `Session` (em `SessionStore`) ganha `userId: string` e `workspace: string`.
- `SessionStore.listSessions(userId)` só retorna sessões daquele usuário.
- `createSession(id, clientName, userId, workspace)` — `userId`/`workspace`
  vêm do middleware de auth do `/mcp` (conhecidos antes mesmo do handshake
  MCP), não precisam de closure como o `sessionId` (que só existe depois do
  `onsessioninitialized`).
- Rotas de sessão/chat/reply (`/session/:id`, `/api/session/:id`,
  `/session/:id/events`, `POST /api/session/:id/reply`) verificam
  `session.userId === req.userId`; se não bater, `404` (não revela que a
  sessão existe).

## Tool `ask_human` com escolha única/múltipla

Mesma tool, dois parâmetros novos e opcionais:

```ts
{
  question: z.string(),
  context: z.string().optional(),
  options: z.array(z.string()).optional(),
  multiple: z.boolean().optional(),
}
```

- Sem `options`: continua sendo pergunta de texto livre (comportamento
  atual, sem mudança).
- Com `options` e sem `multiple`/`multiple: false`: chat mostra radio buttons
  (uma escolha).
- Com `options` e `multiple: true`: chat mostra checkboxes (uma ou mais
  escolhas).
- O contrato de resposta pro agente **não muda**: continua vindo como texto
  simples no resultado da tool. A UI decide esse texto antes de enviar o
  reply — a opção escolhida (radio) ou as escolhidas separadas por vírgula
  (checkbox) — então o `SessionStore`/`resolvePendingRequest` não precisam
  saber a diferença.
- `Message` (só as de `kind: 'question'`) e `PendingRequest` ganham
  `options?: string[]` e `multiple?: boolean`, só pra a UI saber o que
  desenhar e pro servidor validar que o texto respondido é de fato uma
  (ou mais) das opções oferecidas (`400` se não for).

## Redesign visual

Tema claro, paleta slate/indigo, tipografia de sistema (`system-ui`), cards
para lista de sessões e mensagens do chat, badges de status coloridos
(`idle` cinza, `waiting` âmbar, `disconnected` vermelho), formulários
consistentes para login/cadastro/pareamento. Aplica-se a `index.html`,
`session.html` e às três páginas novas (`login.html`, `signup.html`,
`pair.html`). Um único `style.css` compartilhado, sem framework de CSS.

## Erros e casos de borda

- Cadastro com e-mail já existente → `409`.
- `password !== confirmPassword` → `400` (validado no servidor mesmo que a
  UI também valide antes de enviar).
- Login com credenciais inválidas → `401` genérico (não revela se o e-mail
  existe).
- Cookie de sessão web ausente/expirado → páginas redirecionam pra
  `/login?next=...`; APIs respondem `401`.
- Pairing code inexistente/expirado → `/pair/:code` mostra mensagem de erro;
  `GET /api/mcp/pairing/:code` responde `404`/`410`.
- Aprovar/rejeitar um pairing que não está mais `pending` (já aprovado,
  rejeitado ou expirado) → `409`.
- `/mcp` sem Bearer token válido → `401` com `pairingStartUrl` (ver fluxo
  acima), em qualquer método (`POST`/`GET`/`DELETE`).
- Tentar acessar `/session/:id` ou responder a uma sessão de outro usuário →
  `404`.
- Resposta de `ask_human` com `options` que não bate com nenhuma opção
  oferecida → `400`.

## Fora de escopo (por agora)

Confirmação de e-mail por link, recuperação de senha, revogação manual de
tokens MCP pela UI, rate limiting em login/pareamento, múltiplos workspaces
por sessão (1 sessão = 1 workspace, fixado na conexão).
