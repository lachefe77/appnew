document.addEventListener('DOMContentLoaded', async () => {
  const feedback = document.getElementById('social-feedback');
  const connect = document.getElementById('connect-instagram');
  const disconnect = document.getElementById('disconnect-instagram');
  let instagramConnect = false;
  try {
    const offer = await fetch('/api/site/offer').then((response) => response.json());
    instagramConnect = !!offer.instagram_connect;
  } catch {
    instagramConnect = false;
  }
  if (!instagramConnect) {
    if (connect) connect.hidden = true;
    if (disconnect) disconnect.hidden = true;
    if (feedback)
      feedback.textContent =
        'Conexão com Instagram fica oculta até o aplicativo Meta e a URL HTTPS estarem configurados. A assinatura manual continua pelo usuário do perfil.';
    return;
  }
  async function request(path, method = 'GET') {
    const response = await fetch('/api/social' + path, {
      method,
      headers: {
        Authorization: 'Bearer ' + localStorage.getItem('smm_token'),
        'Content-Type': 'application/json',
      },
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'Conexão indisponível.');
    return data;
  }
  async function load() {
    try {
      const data = await request('/');
      const ig = data.connections.find((row) => row.platform === 'instagram');
      if (feedback)
        feedback.textContent = ig
          ? 'Perfil conectado: @' + ig.username + ' · validade: ' + new Date(ig.expires_at).toLocaleDateString('pt-BR')
          : 'Nenhum Instagram conectado.';
    } catch (error) {
      if (feedback) feedback.textContent = error.message;
    }
  }
  if (connect)
    connect.onclick = async () => {
      try {
        const data = await request('/instagram/start', 'POST');
        location.assign(data.url);
      } catch (error) {
        if (feedback) feedback.textContent = error.message;
      }
    };
  if (disconnect)
    disconnect.onclick = async () => {
      try {
        await request('/instagram', 'DELETE');
        await load();
      } catch (error) {
        if (feedback) feedback.textContent = error.message;
      }
    };
  load();
});
