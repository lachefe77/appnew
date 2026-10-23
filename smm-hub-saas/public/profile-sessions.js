(() => {
  const section = document.getElementById('s-security');
  if (!section) return;
  const list = document.createElement('div');
  list.className = 'brand-card';
  list.setAttribute('aria-live', 'polite');
  section.append(list);
  async function load() {
    list.textContent = 'Carregando sessões…';
    try {
      const r = await api('/api/profile/sessions');
      if (r.error) throw new Error();
      list.replaceChildren();
      const title = document.createElement('h3');
      title.textContent = 'Dispositivos conectados';
      list.append(title);
      for (const session of r.sessions) {
        const row = document.createElement('div'),
          text = document.createElement('p'),
          button = document.createElement('button');
        text.textContent =
          (session.jti === r.current_jti ? 'Este dispositivo · ' : '') +
          session.device +
          ' · último uso: ' +
          session.last_seen_at;
        button.textContent = 'Encerrar sessão';
        button.className = 'brand-btn';
        button.onclick = async () => {
          const result = await api(
            '/api/profile/sessions/' +
              encodeURIComponent(session.jti) +
              '/revoke',
            { method: 'POST' }
          );
          if (result.current_session) {
            localStorage.removeItem('smm_token');
            location.href = '/login.html';
          } else await load();
        };
        row.append(text, button);
        list.append(row);
      }
    } catch {
      list.textContent = 'Não foi possível carregar as sessões.';
    }
  }
  load();
})();
