const sessionId = window.location.pathname.split('/').pop();
const messagesEl = document.getElementById('messages');
const replyArea = document.getElementById('reply-area');

function renderMessage(message) {
  const div = document.createElement('div');
  div.className = `message message-${message.role}`;
  div.textContent = `[${message.role}] ${message.text}`;
  messagesEl.appendChild(div);
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

  if (session.pending.kind === 'ask_human') {
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Digite sua resposta...';
    const button = document.createElement('button');
    button.textContent = 'Enviar';
    button.onclick = () => sendReply({ requestId: session.pending.id, text: input.value });
    replyArea.appendChild(input);
    replyArea.appendChild(button);
  } else {
    const approve = document.createElement('button');
    approve.textContent = 'Aprovar';
    approve.onclick = () => sendReply({ requestId: session.pending.id, approved: true });
    const reject = document.createElement('button');
    reject.textContent = 'Rejeitar';
    reject.onclick = () => sendReply({ requestId: session.pending.id, approved: false });
    replyArea.appendChild(approve);
    replyArea.appendChild(reject);
  }
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
