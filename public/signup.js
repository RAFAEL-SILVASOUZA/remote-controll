const form = document.getElementById('signup-form');
const errorEl = document.getElementById('error');

const ERROR_MESSAGES = {
  email_taken: 'Este e-mail já está cadastrado.',
  password_mismatch: 'As senhas não coincidem.',
  invalid_input: 'Verifique os campos preenchidos.',
};

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorEl.hidden = true;
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const confirmPassword = document.getElementById('confirmPassword').value;

  if (password !== confirmPassword) {
    errorEl.textContent = ERROR_MESSAGES.password_mismatch;
    errorEl.hidden = false;
    return;
  }

  const res = await fetch('/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, confirmPassword }),
  });
  if (res.ok) {
    window.location.href = '/';
    return;
  }
  const body = await res.json().catch(() => ({}));
  errorEl.textContent = ERROR_MESSAGES[body.error] ?? 'Não foi possível cadastrar.';
  errorEl.hidden = false;
});
