const list = document.getElementById('token-list');
const newTokenEl = document.getElementById('new-token');
const form = document.getElementById('create-form');
const labelInput = document.getElementById('label-input');

function render(tokens) {
  list.innerHTML = '';
  for (const token of tokens) {
    const li = document.createElement('li');
    const row = document.createElement('div');
    row.className = 'token-row';

    const label = document.createElement('span');
    label.textContent = `${token.label} — criado em ${new Date(token.createdAt).toLocaleString('pt-BR')}`;

    const revoke = document.createElement('button');
    revoke.textContent = 'Revogar';
    revoke.className = 'secondary';
    revoke.onclick = async () => {
      await fetch(`/api/tokens/${token.id}`, { method: 'DELETE' });
      load();
    };

    row.appendChild(label);
    row.appendChild(revoke);
    li.appendChild(row);
    list.appendChild(li);
  }
}

function load() {
  fetch('/api/tokens').then((r) => r.json()).then(render);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const label = labelInput.value.trim() || 'vide-code';
  const res = await fetch('/api/tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label }),
  });
  const created = await res.json();
  newTokenEl.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'auth-card';
  box.textContent = `Token gerado (copie agora, não será mostrado de novo): ${created.secret}`;
  newTokenEl.appendChild(box);
  labelInput.value = '';
  load();
});

load();

document.getElementById('logout').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login';
});
