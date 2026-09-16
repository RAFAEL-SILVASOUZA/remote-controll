const sessionId = window.location.pathname.split('/').pop();
const messagesEl = document.getElementById('messages');
const replyArea = document.getElementById('reply-area');

if (window.mermaid) {
  window.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
}

let mermaidDiagramCount = 0;
const MERMAID_BLOCK = /```mermaid\n([\s\S]*?)```/g;

async function renderMessage(message) {
  const div = document.createElement('div');
  div.className = `message message-${message.role}`;

  const prefix = document.createElement('span');
  prefix.className = 'message-prefix';
  prefix.textContent = `[${message.role}] `;
  div.appendChild(prefix);

  const text = message.text;
  let lastIndex = 0;
  let match;
  MERMAID_BLOCK.lastIndex = 0;
  const diagrams = [];
  while ((match = MERMAID_BLOCK.exec(text)) !== null) {
    if (match.index > lastIndex) {
      div.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    }
    const placeholder = document.createElement('div');
    placeholder.className = 'mermaid-diagram';
    div.appendChild(placeholder);
    diagrams.push({ placeholder, source: match[1] });
    lastIndex = MERMAID_BLOCK.lastIndex;
  }
  if (lastIndex < text.length) {
    div.appendChild(document.createTextNode(text.slice(lastIndex)));
  }

  messagesEl.appendChild(div);

  for (const { placeholder, source } of diagrams) {
    if (!window.mermaid) {
      placeholder.textContent = source;
      continue;
    }
    try {
      const id = `mermaid-diagram-${mermaidDiagramCount++}`;
      const { svg } = await window.mermaid.render(id, source);
      placeholder.innerHTML = svg;
    } catch (err) {
      placeholder.textContent = source;
    }
  }
}

function renderReplyArea(session) {
  replyArea.innerHTML = '';
  if (session.status === 'disconnected') {
    replyArea.textContent = 'Agente desconectado.';
    return;
  }
  if (!session.pending) {
    replyArea.textContent = 'Sem perguntas pendentes.';
    return;
  }

  if (session.pending.kind === 'confirm_action') {
    const approve = document.createElement('button');
    approve.textContent = 'Aprovar';
    approve.onclick = () => sendReply({ requestId: session.pending.id, approved: true });
    const reject = document.createElement('button');
    reject.textContent = 'Rejeitar';
    reject.className = 'secondary';
    reject.onclick = () => sendReply({ requestId: session.pending.id, approved: false });
    replyArea.appendChild(approve);
    replyArea.appendChild(reject);
    return;
  }

  if (session.pending.options && session.pending.options.length > 0) {
    const list = document.createElement('div');
    list.className = 'options-list';
    const inputType = session.pending.multiple ? 'checkbox' : 'radio';
    for (const option of session.pending.options) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = inputType;
      input.name = 'option';
      input.value = option;
      label.appendChild(input);
      label.appendChild(document.createTextNode(option));
      list.appendChild(label);
    }
    const button = document.createElement('button');
    button.textContent = 'Enviar';
    button.onclick = () => {
      const checked = [...list.querySelectorAll('input:checked')].map((el) => el.value);
      if (checked.length === 0) return;
      sendReply({ requestId: session.pending.id, text: checked.join(', ') });
    };
    replyArea.appendChild(list);
    replyArea.appendChild(button);
    return;
  }

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Digite sua resposta...';
  const button = document.createElement('button');
  button.textContent = 'Enviar';
  button.onclick = () => sendReply({ requestId: session.pending.id, text: input.value });
  replyArea.appendChild(input);
  replyArea.appendChild(button);
}

async function sendReply(body) {
  const res = await fetch(`/api/session/${sessionId}/reply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error';
    errorDiv.textContent = `Erro ao responder (${res.status}).`;
    replyArea.appendChild(errorDiv);
  }
}

fetch(`/api/session/${sessionId}`)
  .then((r) => r.json())
  .then((session) => {
    session.messages.forEach(renderMessage);
    renderReplyArea(session);
  });

const events = new EventSource(`/session/${sessionId}/events`);
events.addEventListener('update', (event) => {
  const { message, session } = JSON.parse(event.data);
  renderMessage(message);
  if (session) renderReplyArea(session);
});

document.getElementById('logout').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login';
});
