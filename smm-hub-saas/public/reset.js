document.getElementById('reset-form').onsubmit = async (event) => {
  event.preventDefault();
  const form = event.currentTarget,
    button = form.querySelector('button'),
    message = document.getElementById('message');
  button.disabled = true;
  try {
    const token = new URLSearchParams(location.search).get('token');
    const r = await fetch('/api/auth/password-reset/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        new_password: document.getElementById('password').value,
      }),
    });
    const data = await r.json();
    message.textContent = data.message || data.error;
    if (r.ok) {
      form.reset();
      history.replaceState(null, '', location.pathname);
    }
  } catch {
    message.textContent = 'Conexão indisponível. Tente novamente.';
  } finally {
    button.disabled = false;
  }
};
