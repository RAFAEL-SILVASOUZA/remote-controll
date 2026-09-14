const form = document.getElementById('login-form');
const errorEl = document.getElementById('error');

function nextUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('next') || '/';
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorEl.hidden = true;
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (res.ok) {
    window.location.href = nextUrl();
    return;
  }
  errorEl.textContent = 'E-mail ou senha inválidos.';
  errorEl.hidden = false;
});
