const list = document.getElementById('sessions');
const empty = document.getElementById('empty');

function render(conversations) {
  list.innerHTML = '';
  empty.hidden = conversations.length > 0;
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
