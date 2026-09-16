const list = document.getElementById('sessions');
const empty = document.getElementById('empty');
const newChatBtn = document.getElementById('new-chat');
const newChatStatus = document.getElementById('new-chat-status');

let knownIds = new Set();
let awaitingNew = false;
let awaitingTimer = null;

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
    label.appendChild(name);

    const badge = document.createElement('span');
    badge.className = `badge badge-${conversation.status}`;
    badge.textContent = conversation.status;

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

newChatBtn.addEventListener('click', async () => {
  newChatBtn.disabled = true;
  newChatStatus.textContent = 'Abrindo nova aba no vide-code...';
  newChatStatus.hidden = false;
  try {
    const res = await fetch('/api/conversations/new', { method: 'POST' });
    if (!res.ok) {
      newChatStatus.textContent = res.status === 409
        ? 'O vide-code não está conectado agora.'
        : 'Não foi possível abrir a conversa.';
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
});
