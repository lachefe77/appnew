(() => {
  const mount = document.getElementById('pane-settings');
  if (!mount) return;
  const pane = document.createElement('div');
  pane.className = 'pane';
  pane.id = 'pane-integrations';
  mount.parentElement.append(pane);
  const nav = document.createElement('button');
  nav.className = 'side-item';
  nav.textContent = 'Integrações de pagamento';
  nav.type = 'button';
  document.querySelector('.side-item')?.parentElement.append(nav);
  nav.onclick = async () => {
    document
      .querySelectorAll('.pane')
      .forEach((p) => p.classList.remove('active'));
    pane.classList.add('active');
    pane.replaceChildren();
    const title = document.createElement('h2');
    title.textContent = 'Configuração de Pix e cripto';
    pane.append(title);
    const info = document.createElement('p');
    info.textContent =
      'Somente CEO. As chaves são gravadas com criptografia e nunca retornam ao navegador. Salvar não confirma homologação ou recebimento.';
    pane.append(info);
    try {
      const data = await api('/api/admin/integrations');
      const form = document.createElement('form');
      const controls = {};
      for (const [key, state] of Object.entries(data.fields)) {
        const label = document.createElement('label');
        label.textContent = key;
        label.style.display = 'block';
        let input;
        if (key.endsWith('provider')) {
          input = document.createElement('select');
          for (const value of key.startsWith('pix')
            ? ['disabled', 'mock', 'mercadopago']
            : ['disabled', 'mock', 'nowpayments']) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = value;
            input.append(option);
          }
          input.value = state.value || 'disabled';
        } else {
          input = document.createElement('input');
          input.type = Object.hasOwn(state, 'configured') ? 'password' : 'url';
          input.autocomplete = 'off';
          input.value = state.value || '';
          input.placeholder = state.configured
            ? 'Configurado; deixe vazio para preservar'
            : 'Não configurado';
        }
        input.className = 'input';
        controls[key] = input;
        label.append(input);
        form.append(label);
      }
      const label = document.createElement('label');
      label.textContent = 'Sua senha atual';
      const password = document.createElement('input');
      password.type = 'password';
      password.required = true;
      password.autocomplete = 'current-password';
      password.className = 'input';
      label.append(password);
      form.append(label);
      const button = document.createElement('button');
      button.type = 'submit';
      button.textContent = 'Salvar configurações';
      button.className = 'btn btn-primary';
      form.append(button);
      const message = document.createElement('p');
      message.setAttribute('role', 'status');
      form.append(message);
      form.onsubmit = async (event) => {
        event.preventDefault();
        button.disabled = true;
        try {
          const values = Object.fromEntries(
            Object.entries(controls)
              .filter(([k, c]) => c.type !== 'password' || c.value)
              .map(([k, c]) => [k, c.value])
          );
          const r = await api('/api/admin/integrations', {
            method: 'PUT',
            body: JSON.stringify({ password: password.value, values }),
          });
          message.textContent = r.message || r.error;
          password.value = '';
          for (const c of Object.values(controls))
            if (c.type === 'password') c.value = '';
        } catch {
          message.textContent =
            'Não foi possível salvar. Confira permissões e configuração do servidor.';
        } finally {
          button.disabled = false;
        }
      };
      if (!data.encrypted_storage_ready) {
        const warning = document.createElement('p');
        warning.textContent =
          'Antes de gravar chaves, configure SETTINGS_ENCRYPTION_KEY no ambiente da VPS. O comando setup:env prepara essa chave.';
        pane.append(warning);
      }
      pane.append(form);
    } catch {
      const error = document.createElement('p');
      error.textContent = 'Acesso restrito ao CEO ou integração indisponível.';
      pane.append(error);
    }
  };
})();
