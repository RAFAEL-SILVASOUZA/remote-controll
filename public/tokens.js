const list = document.getElementById('token-list');
const newTokenEl = document.getElementById('new-token');
const form = document.getElementById('create-form');
const labelInput = document.getElementById('label-input');

const COPY_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
const TRASH_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CHECK_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 12l5 5L20 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function render(tokens) {
  list.innerHTML = '';
  for (const token of tokens) {
    const li = document.createElement('li');
    const row = document.createElement('div');
    row.className = 'token-row';

    const label = document.createElement('span');
    label.textContent = `${token.label} · criado em ${new Date(token.createdAt).toLocaleString('pt-BR')}`;

    const revoke = document.createElement('button');
    revoke.className = 'icon-btn danger';
    revoke.innerHTML = TRASH_ICON;
    revoke.setAttribute('aria-label', 'Revogar token');
    revoke.title = 'Revogar';
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
  box.className = 'token-reveal';

  const hint = document.createElement('p');
  hint.className = 'token-reveal-hint';
  hint.textContent = 'Copie agora, não será mostrado de novo.';
  box.appendChild(hint);

  const row = document.createElement('div');
  row.className = 'token-reveal-row';
  const code = document.createElement('code');
  code.className = 'token-reveal-value';
  code.textContent = created.secret;
  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'icon-btn';
  copyBtn.innerHTML = COPY_ICON;
  copyBtn.setAttribute('aria-label', 'Copiar token');
  copyBtn.title = 'Copiar';
  copyBtn.onclick = async () => {
    try {
      await navigator.clipboard.writeText(created.secret);
      copyBtn.innerHTML = CHECK_ICON;
      setTimeout(() => { copyBtn.innerHTML = COPY_ICON; }, 1200);
    } catch {
      // clipboard indisponível (ex: contexto não seguro); ignora silenciosamente
    }
  };
  row.appendChild(code);
  row.appendChild(copyBtn);
  box.appendChild(row);

  newTokenEl.appendChild(box);
  labelInput.value = '';
  load();
});

load();

document.getElementById('logout').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login';
});
