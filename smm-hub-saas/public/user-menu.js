function escapeText(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]
  );
}
/**
 * Injeta dropdown de usuário (nome · cargo · menu com perfil/tickets/admin/logout)
 * no topo do dashboard sem precisar reescrever o app.js inteiro.
 */
(function () {
  const token = localStorage.getItem('smm_token');
  if (!token) return;

  const ROLE_LABEL = {
    ceo: 'CEO',
    admin: 'Admin',
    support: 'Suporte',
    vip: 'VIP',
    user: 'Cliente',
  };
  const ROLE_COLOR = {
    ceo: '#d9ff00',
    admin: '#a855f7',
    support: '#3b82f6',
    vip: '#f59e0b',
    user: '#737373',
  };

  async function fetchUser() {
    try {
      const r = await fetch('/api/auth/me', {
        headers: { Authorization: 'Bearer ' + token },
      });
      if (r.status === 401) return { unauthorized: true };
      if (!r.ok) return null;
      return (await r.json()).user;
    } catch {
      return null;
    }
  }

  function render(user) {
    const existing = document.getElementById('smm-user-menu');
    if (existing) existing.remove();

    const roleLabel = ROLE_LABEL[user.role] || user.role;
    const roleColor = ROLE_COLOR[user.role] || '#737373';
    const roleIsStaff = ['ceo', 'admin', 'support'].includes(user.role);

    const wrap = document.createElement('div');
    wrap.id = 'smm-user-menu';
    wrap.style.cssText = `position: fixed; top: 10px; right: 24px; z-index: 9999; font-family: Inter, sans-serif;`;
    wrap.innerHTML = `
      <button id="smm-um-btn" style="display:flex;align-items:center;gap:10px;background:#141414;border:1px solid #262626;border-radius:10px;padding:7px 12px;cursor:pointer;color:#f5f5f5;font-size:13px;font-family:inherit;">
        <div style="width:26px;height:26px;background:${roleColor};color:#000;border-radius:6px;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:12px;">
          ${escapeText(user.name.charAt(0).toUpperCase())}
        </div>
        <div style="text-align:left;line-height:1.1;">
          <div style="font-weight:600;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeText(user.name)}</div>
          <div style="font-size:10px;color:${roleColor};letter-spacing:0.08em;text-transform:uppercase;font-weight:700;">${roleLabel}</div>
        </div>
        <i class="fa-solid fa-chevron-down" style="font-size:10px;color:#737373;margin-left:4px;"></i>
      </button>
      <div id="smm-um-dropdown" style="display:none;position:absolute;top:48px;right:0;background:#141414;border:1px solid #262626;border-radius:10px;min-width:220px;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,0.5);">
        <div style="padding:14px 16px;border-bottom:1px solid #262626;">
          <div style="font-size:11px;color:#525252;text-transform:uppercase;letter-spacing:0.08em;">Saldo</div>
          <div style="font-family:'JetBrains Mono',monospace;font-size:18px;color:#d9ff00;font-weight:700;margin-top:2px;">R$ ${(user.balance_cents / 100).toFixed(2).replace('.', ',')}</div>
        </div>
        <a href="/profile.html" style="display:flex;gap:10px;align-items:center;padding:11px 16px;color:#a3a3a3;text-decoration:none;font-size:13px;" onmouseover="this.style.background='#1c1c1c';this.style.color='#f5f5f5'" onmouseout="this.style.background='';this.style.color='#a3a3a3'"><i class="fa-solid fa-user" style="width:16px"></i>Meu perfil</a>
        <a href="/tickets.html" style="display:flex;gap:10px;align-items:center;padding:11px 16px;color:#a3a3a3;text-decoration:none;font-size:13px;" onmouseover="this.style.background='#1c1c1c';this.style.color='#f5f5f5'" onmouseout="this.style.background='';this.style.color='#a3a3a3'"><i class="fa-solid fa-life-ring" style="width:16px"></i>Suporte</a>
        ${roleIsStaff ? `<a href="/admin.html" style="display:flex;gap:10px;align-items:center;padding:11px 16px;color:#d9ff00;text-decoration:none;font-size:13px;border-top:1px solid #262626;" onmouseover="this.style.background='#1c1c1c'" onmouseout="this.style.background=''"><i class="fa-solid fa-chart-line" style="width:16px"></i>Painel admin</a>` : ''}
        <a href="/vitrine.html" style="display:flex;gap:10px;align-items:center;padding:11px 16px;color:#a3a3a3;text-decoration:none;font-size:13px;border-top:1px solid #262626;" onmouseover="this.style.background='#1c1c1c';this.style.color='#f5f5f5'" onmouseout="this.style.background='';this.style.color='#a3a3a3'"><i class="fa-solid fa-house" style="width:16px"></i>Ver vitrine</a>
        <button id="smm-um-logout" style="display:flex;gap:10px;align-items:center;padding:11px 16px;color:#fca5a5;background:none;border:0;width:100%;text-align:left;cursor:pointer;font-size:13px;border-top:1px solid #262626;font-family:inherit;" onmouseover="this.style.background='#1c1c1c'" onmouseout="this.style.background=''"><i class="fa-solid fa-right-from-bracket" style="width:16px"></i>Sair da conta</button>
      </div>
    `;
    document.body.appendChild(wrap);
    if (roleIsStaff) {
      const link = document.createElement('a');
      link.href = '/support.html';
      link.textContent = 'Atendimento da equipe';
      link.style.cssText =
        'display:block;padding:11px 16px;color:#a3a3a3;text-decoration:none;font-size:13px';
      document.getElementById('smm-um-dropdown').prepend(link);
      if (user.role === 'support')
        document
          .querySelector('#smm-um-dropdown a[href="/admin.html"]')
          ?.remove();
    }

    const btn = document.getElementById('smm-um-btn');
    const dd = document.getElementById('smm-um-dropdown');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
    });
    document.addEventListener('click', () => (dd.style.display = 'none'));

    document
      .getElementById('smm-um-logout')
      .addEventListener('click', async () => {
        try {
          await fetch('/api/auth/logout', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + token },
          });
        } catch {}
        localStorage.removeItem('smm_token');
        localStorage.removeItem('smm_user');
        location.href = '/vitrine.html';
      });
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', init);
  else init();

  async function init() {
    const user = await fetchUser();
    if (!user) return;
    if (user.unauthorized) {
      localStorage.removeItem('smm_token');
      location.href = '/login.html';
      return;
    }
    render(user);
  }
})();
