(() => {
  const section = document.getElementById('s-security');
  if (!section) return;
  const card = document.createElement('div'),
    title = document.createElement('h3'),
    message = document.createElement('p'),
    button = document.createElement('button');
  card.className = 'brand-card';
  title.textContent = 'Confirmação do e-mail';
  message.setAttribute('role', 'status');
  button.className = 'brand-btn';
  button.textContent = 'Enviar link de confirmação';
  button.onclick = async () => {
    button.disabled = true;
    try {
      const response = await api('/api/auth/email-verification/request', {
        method: 'POST',
        body: '{}',
      });
      message.textContent =
        response.message || response.error || 'Não foi possível enviar.';
    } catch {
      message.textContent = 'Serviço indisponível. Tente novamente.';
    } finally {
      button.disabled = false;
    }
  };
  card.append(title, message, button);
  section.append(card);
  api('/api/profile')
    .then((response) => {
      if (response.user?.email_verified) {
        message.textContent = 'E-mail confirmado.';
        button.hidden = true;
      } else
        message.textContent =
          'Confirme o endereço para manter sua conta recuperável.';
    })
    .catch(() => {
      message.textContent = 'Não foi possível consultar a confirmação.';
    });
})();
