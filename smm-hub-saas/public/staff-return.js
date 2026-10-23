(() => {
  const staff = sessionStorage.getItem('smm_staff_token');
  if (!staff) return;
  const bar = document.createElement('div');
  bar.setAttribute('role', 'status');
  bar.style.cssText =
    'position:sticky;top:0;z-index:80;display:flex;gap:12px;align-items:center;justify-content:space-between;padding:10px 16px;background:#111;color:#f5f5f5;border-bottom:1px solid #333';
  const text = document.createElement('span');
  text.textContent =
    'Consulta de cliente aberta. A sessão de administração continua neste navegador.';
  const back = document.createElement('button');
  back.type = 'button';
  back.textContent = 'Voltar ao admin';
  back.style.cssText =
    'background:#d9ff00;color:#111;border:0;border-radius:8px;padding:8px 12px;font-weight:700;cursor:pointer';
  back.onclick = () => {
    localStorage.setItem('smm_token', staff);
    sessionStorage.removeItem('smm_staff_token');
    location.href = '/admin.html';
  };
  bar.append(text, back);
  document.body.prepend(bar);
})();
