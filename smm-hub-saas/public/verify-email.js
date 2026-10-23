document.getElementById('verify').onclick = async () => {
  const button = document.getElementById('verify');
  button.disabled = true;
  try {
    const token = new URLSearchParams(location.search).get('token');
    const r = await fetch('/api/auth/email-verification/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const data = await r.json();
    document.getElementById('message').textContent = data.message || data.error;
    if (r.ok) history.replaceState(null, '', location.pathname);
  } catch {
    document.getElementById('message').textContent = 'Conexão indisponível.';
  } finally {
    button.disabled = false;
  }
};
