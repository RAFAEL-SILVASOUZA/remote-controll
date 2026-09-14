const code = window.location.pathname.split('/').pop();
const workspaceEl = document.getElementById('workspace');
const actionsEl = document.getElementById('actions');
const resultEl = document.getElementById('result');

async function load() {
  const res = await fetch(`/api/pair/${code}`);
  if (!res.ok) {
    workspaceEl.textContent = 'Este pareamento não existe mais ou expirou.';
    actionsEl.hidden = true;
    return;
  }
  const pairing = await res.json();
  workspaceEl.textContent = `Workspace: ${pairing.workspace ?? 'desconhecido'}`;
  if (pairing.status !== 'pending') {
    actionsEl.hidden = true;
    resultEl.textContent = pairing.status === 'approved' ? 'Já aprovado.' : 'Já rejeitado.';
    resultEl.hidden = false;
  }
}

async function respond(action) {
  const res = await fetch(`/api/pair/${code}/${action}`, { method: 'POST' });
  actionsEl.hidden = true;
  resultEl.textContent = res.ok
    ? action === 'approve'
      ? 'Agente aprovado! Pode voltar pro terminal.'
      : 'Agente rejeitado.'
    : 'Não foi possível concluir — tente recarregar a página.';
  resultEl.hidden = false;
}

document.getElementById('approve').onclick = () => respond('approve');
document.getElementById('reject').onclick = () => respond('reject');

load();
