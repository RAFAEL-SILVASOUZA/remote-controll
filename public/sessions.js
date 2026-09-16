const list = document.getElementById('sessions');
const empty = document.getElementById('empty');
const newChatBtn = document.getElementById('new-chat');
const newChatStatus = document.getElementById('new-chat-status');
const newChatPicker = document.getElementById('new-chat-picker');

let knownIds = new Set();
let awaitingNew = false;
let awaitingTimer = null;
const statusLabels = {
  idle: 'Disponível', queued: 'Na fila', streaming: 'Em andamento',
  waiting_user: 'Aguarda resposta', completed: 'Concluída', cancelled: 'Interrompida',
  error: 'Erro', disconnected: 'Desconectada',
};

function render(conversations) {
  list.innerHTML = '';
  empty.hidden = conversations.length > 0;
  if (awaitingNew) {
    const fresh = conversations.find((c) => !knownIds.has(c.id));
    if (fresh) {
      awaitingNew = false;
      clearTimeout(awaitingTimer);
      window.location.href = `/conversations/${fresh.id}`;
      return;
    }
  }
  knownIds = new Set(conversations.map((c) => c.id));
  for (const conversation of conversations) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = `/conversations/${conversation.id}`;

    const label = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = conversation.title || conversation.id;
    name.title = name.textContent;
    label.appendChild(name);

    const badge = document.createElement('span');
    badge.className = `badge badge-${conversation.status}`;
    badge.textContent = statusLabels[conversation.status] || conversation.status;

    a.appendChild(label);
    a.appendChild(badge);
    li.appendChild(a);
    list.appendChild(li);
  }
}

fetch('/api/conversations').then((r) => r.json()).then(render);

const events = new EventSource('/events');
events.addEventListener('conversations', (event) => {
  render(JSON.parse(event.data));
});

document.getElementById('logout').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login';
});

function formatConnectionLabel(connection) {
  return connection.label || `Janela conectada às ${new Date(connection.connectedAt).toLocaleTimeString('pt-BR')}`;
}

function showPicker(connections) {
  newChatPicker.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.selected = true;
  placeholder.disabled = true;
  placeholder.textContent = 'Em qual janela do VS Code?';
  newChatPicker.appendChild(placeholder);
  for (const connection of connections) {
    const option = document.createElement('option');
    option.value = connection.id;
    option.textContent = formatConnectionLabel(connection);
    newChatPicker.appendChild(option);
  }
  newChatPicker.hidden = false;
  newChatStatus.hidden = true;
}

async function requestNewConversation(connectionId) {
  newChatBtn.disabled = true;
  newChatPicker.hidden = true;
  newChatStatus.textContent = 'Abrindo nova aba no vide-code...';
  newChatStatus.hidden = false;
  try {
    const res = await fetch('/api/conversations/new', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(connectionId ? { connectionId } : {}),
    });
    if (res.status === 409) {
      const body = await res.json().catch(() => null);
      if (body?.error === 'ambiguous_connection' && Array.isArray(body.connections)) {
        showPicker(body.connections);
        newChatBtn.disabled = false;
        return;
      }
      newChatStatus.textContent = 'O vide-code não está conectado agora.';
      newChatBtn.disabled = false;
      return;
    }
    if (!res.ok) {
      newChatStatus.textContent = 'Não foi possível abrir a conversa.';
      newChatBtn.disabled = false;
      return;
    }
    awaitingNew = true;
    awaitingTimer = setTimeout(() => {
      if (!awaitingNew) return;
      awaitingNew = false;
      newChatStatus.textContent = 'O vide-code demorou demais para responder.';
      newChatBtn.disabled = false;
    }, 20000);
  } catch {
    newChatStatus.textContent = 'Não foi possível abrir a conversa.';
    newChatBtn.disabled = false;
  }
}

newChatBtn.addEventListener('click', () => requestNewConversation());
newChatPicker.addEventListener('change', () => {
  const connectionId = newChatPicker.value;
  if (connectionId) requestNewConversation(connectionId);
});
