const list = document.getElementById('sessions');
const empty = document.getElementById('empty');

function render(sessions) {
  list.innerHTML = '';
  empty.hidden = sessions.length > 0;
  for (const session of sessions) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = `/session/${session.id}`;
    a.textContent = `${session.clientName} — ${session.status}`;
    li.appendChild(a);
    list.appendChild(li);
  }
}

fetch('/api/sessions').then((r) => r.json()).then(render);

const events = new EventSource('/events');
events.addEventListener('sessions', (event) => {
  render(JSON.parse(event.data));
});
