const list = document.getElementById('sessions');
const empty = document.getElementById('empty');

function render(sessions) {
  list.innerHTML = '';
  empty.hidden = sessions.length > 0;
  for (const session of sessions) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = `/session/${session.id}`;

    const label = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = session.clientName;
    const workspace = document.createElement('span');
    workspace.className = 'workspace';
    workspace.textContent = session.workspace;
    label.appendChild(name);
    label.appendChild(workspace);

    const badge = document.createElement('span');
    badge.className = `badge badge-${session.status}`;
    badge.textContent = session.status;

    a.appendChild(label);
    a.appendChild(badge);
    li.appendChild(a);
    list.appendChild(li);
  }
}

fetch('/api/sessions').then((r) => r.json()).then(render);

const events = new EventSource('/events');
events.addEventListener('sessions', (event) => {
  render(JSON.parse(event.data));
});

document.getElementById('logout').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login';
});
