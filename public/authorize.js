const params = new URLSearchParams(window.location.search);
const clientId = params.get('client_id');
const redirectUri = params.get('redirect_uri');
const codeChallenge = params.get('code_challenge');
const codeChallengeMethod = params.get('code_challenge_method');
const state = params.get('state');

const infoEl = document.getElementById('client-info');
const actionsEl = document.getElementById('actions');
const resultEl = document.getElementById('result');

function showError(message) {
  infoEl.hidden = true;
  actionsEl.hidden = true;
  resultEl.textContent = message;
  resultEl.hidden = false;
}

async function load() {
  if (!clientId || !redirectUri || !codeChallenge || !codeChallengeMethod) {
    showError('Requisição de autorização inválida.');
    return;
  }
  const res = await fetch(`/api/oauth/authorize/info?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}`);
  if (!res.ok) {
    showError('Client ou redirect_uri desconhecido.');
    return;
  }
  const info = await res.json();
  infoEl.textContent = `"${info.clientName}" quer se conectar à sua conta.`;
  actionsEl.hidden = false;
}

async function decide(decision) {
  actionsEl.hidden = true;
  const res = await fetch('/api/oauth/authorize/decide', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      decision,
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: codeChallenge,
      code_challenge_method: codeChallengeMethod,
      state,
    }),
  });
  if (!res.ok) {
    showError('Não foi possível concluir — tente recarregar a página.');
    return;
  }
  const { redirectTo } = await res.json();
  window.location.href = redirectTo;
}

document.getElementById('approve').addEventListener('click', () => decide('approve'));
document.getElementById('reject').addEventListener('click', () => decide('reject'));

load();
