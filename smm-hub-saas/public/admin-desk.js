(() => {
  const say = (message) => {
    const slot = document.getElementById('admin-feedback');
    if (slot) slot.textContent = message || '';
  };
  const cents = (value) => Math.round(Number(String(value ?? '').replace(',', '.')) * 100);
  const money = (value) =>
    (Number(value || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const esc = (value) => escapeHtml(value);
  async function run(work, ok) {
    try {
      const result = await work();
      say(ok || result?.message || 'Salvo.');
      return result;
    } catch (error) {
      say(error.message || 'Não foi possível concluir.');
      return null;
    }
  }
  function mountChart(id, config) {
    const canvas = document.getElementById(id);
    const current = typeof Chart.getChart === 'function' ? Chart.getChart(canvas) : null;
    if (current) current.destroy();
    return new Chart(canvas, config);
  }
  function field(label, value, type = 'text') {
    const wrap = document.createElement('label');
    wrap.style.display = 'block';
    wrap.style.margin = '8px 0';
    wrap.append(document.createTextNode(label));
    const input = document.createElement('input');
    input.className = 'input';
    input.type = type;
    input.value = value ?? '';
    wrap.append(input);
    return { wrap, input };
  }
  function dialog(title, nodes, onSave) {
    const box = document.createElement('dialog');
    const form = document.createElement('form');
    form.style.minWidth = '320px';
    const heading = document.createElement('h2');
    heading.textContent = title;
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    const save = document.createElement('button');
    save.className = 'btn btn-primary';
    save.type = 'submit';
    save.textContent = 'Salvar';
    const cancel = document.createElement('button');
    cancel.className = 'btn btn-ghost';
    cancel.type = 'button';
    cancel.textContent = 'Cancelar';
    cancel.onclick = () => box.close();
    form.append(heading, ...nodes, status, save, cancel);
    form.onsubmit = async (event) => {
      event.preventDefault();
      save.disabled = true;
      try {
        await onSave(status);
        box.close();
      } catch (error) {
        status.textContent = error.message || 'Não foi possível salvar.';
      } finally {
        save.disabled = false;
      }
    };
    box.append(form);
    document.body.append(box);
    box.onclose = () => box.remove();
    box.showModal();
  }

  document.getElementById('menu-toggle')?.addEventListener('click', () => {
    document.querySelector('aside')?.classList.toggle('open');
  });
  document.querySelectorAll('.side-item').forEach((item) => {
    item.addEventListener('click', () => {
      if (window.matchMedia('(max-width: 860px)').matches)
        document.querySelector('aside')?.classList.remove('open');
    });
  });

  const originalDash = loadDash;
  loadDash = async function () {
    const [metrics, byPlatform, snaps, me] = await Promise.all([
      api('/api/admin/metrics'),
      api('/api/admin/metrics/by-platform'),
      api('/api/admin/snapshots?days=30'),
      api('/api/auth/me'),
    ]);
    document.getElementById('who').textContent = me.user.name;
    document.getElementById('k-rev').textContent = metrics.orders.total_revenue_formatted;
    document.getElementById('k-prof').textContent =
      metrics.orders.total_profit_formatted + ` (${metrics.orders.margin_pct}%)`;
    document.getElementById('k-act').textContent = metrics.orders.active;
    document.getElementById('k-usr').textContent = metrics.users.total;
    const rows = snaps.snapshots || [];
    mountChart('c-30d', {
      type: 'line',
      data: {
        labels: rows.map((row) => row.snapshot_date),
        datasets: [{ label: 'Receita (R$)', data: rows.map((row) => row.revenue_cents / 100), borderColor: '#38bdf8', tension: 0.3 }],
      },
    });
    const platforms = byPlatform.by_platform || [];
    mountChart('c-plat', {
      type: 'bar',
      data: {
        labels: platforms.map((row) => row.platform),
        datasets: [{ label: 'Lucro estimado (R$)', data: platforms.map((row) => row.profit_cents / 100), backgroundColor: '#10b981' }],
      },
    });
    if (['ceo', 'admin', 'support'].includes(me.user.role) && !me.user.two_factor_enabled) {
      say('Ative o 2FA no perfil antes de publicar esta administração.');
      const config = await fetch('/api/auth/public-config').then((response) => response.json());
      if (config.production) {
        document.querySelectorAll('.pane').forEach((pane) => pane.classList.remove('active'));
        const gate = document.getElementById('auth-gate');
        gate.classList.remove('hidden');
        gate.textContent = '';
        const link = document.createElement('a');
        link.href = '/profile.html';
        link.textContent = 'Ativar 2FA no perfil';
        gate.append('A produção exige segundo fator para CEO, admin e suporte. ', link);
      }
    }
  };
  loaders.dashboard = loadDash;
  if (token) loadDash().catch((error) => say(error.message));

  window.addCoupon = async function () {
    const result = await run(() =>
      api('/api/admin/coupons', {
        method: 'POST',
        body: JSON.stringify({
          code: document.getElementById('cp-code').value,
          discount_pct: document.getElementById('cp-pct').value,
          fixed_cents: cents(document.getElementById('cp-fix').value),
          min_order_cents: cents(document.getElementById('cp-min').value),
          max_uses: document.getElementById('cp-max').value,
        }),
      })
    );
    if (result) loadCoupons();
  };
  window.addAnnouncement = async function () {
    const result = await run(() =>
      api('/api/admin/announcements', {
        method: 'POST',
        body: JSON.stringify({
          title: document.getElementById('an-title').value,
          message: document.getElementById('an-msg').value,
          badge: document.getElementById('an-badge').value,
          is_active: 1,
        }),
      })
    );
    if (result) loadAnnouncements();
  };
  window.addGiveaway = async function () {
    const result = await run(() =>
      api('/api/engagement/giveaways', {
        method: 'POST',
        body: JSON.stringify({
          title: document.getElementById('gv-title').value,
          prize_cents: cents(document.getElementById('gv-prize').value),
          min_deposit_cents: cents(document.getElementById('gv-min').value),
          starts_at: new Date(document.getElementById('gv-start').value).toISOString(),
          ends_at: new Date(document.getElementById('gv-end').value).toISOString(),
        }),
      })
    , 'Sorteio criado.');
    if (result && loaders.giveaways) loaders.giveaways();
  };
  window.addPricing = async function () {
    const result = await run(() =>
      api('/api/intelligence/pricing/rules', {
        method: 'POST',
        body: JSON.stringify({
          platform: document.getElementById('dp-plat').value,
          day_of_week: document.getElementById('dp-dow').value || null,
          hour_from: document.getElementById('dp-hf').value || null,
          hour_to: document.getElementById('dp-ht').value || null,
          multiplier: document.getElementById('dp-mult').value,
        }),
      })
    );
    if (result) loadPricing();
  };
  window.addBlocked = async function () {
    const result = await run(() =>
      api('/api/admin/blocked-links', {
        method: 'POST',
        body: JSON.stringify({
          pattern: document.getElementById('bl-pat').value,
          reason: document.getElementById('bl-reas').value,
        }),
      })
    );
    if (result) loadBlocked();
  };
  window.retry = async function (id) {
    const result = await run(() => api('/api/admin/orders/' + id + '/retry', { method: 'POST' }));
    if (result) loadOrders();
  };
  window.resetMemberPw = async function (id) {
    const password = prompt('Nova senha (12 a 128 caracteres):');
    if (!password) return;
    if (password.length < 12 || password.length > 128) {
      say('A senha precisa ter entre 12 e 128 caracteres.');
      return;
    }
    const result = await run(() =>
      api('/api/team/' + id + '/reset-password', {
        method: 'POST',
        body: JSON.stringify({ new_password: password }),
      })
    );
    if (result) say(result.message);
  };
  window.impersonate = async function (id) {
    const password = await new Promise((resolve) => {
      const box = document.createElement('dialog');
      const form = document.createElement('form');
      form.method = 'dialog';
      const label = document.createElement('label');
      label.textContent = 'Confirme sua senha. A consulta dura 15 minutos e não apaga sua sessão de admin.';
      const input = document.createElement('input');
      input.type = 'password';
      input.autocomplete = 'current-password';
      input.required = true;
      label.append(input);
      const button = document.createElement('button');
      button.textContent = 'Abrir consulta';
      form.append(label, button);
      box.append(form);
      document.body.append(box);
      box.onclose = () => {
        resolve(input.value);
        box.remove();
      };
      box.showModal();
    });
    if (!password) return;
    const result = await run(() =>
      api('/api/admin/users/' + id + '/impersonate', {
        method: 'POST',
        body: JSON.stringify({ password }),
      })
    );
    if (result?.token) {
      sessionStorage.setItem('smm_staff_token', localStorage.getItem('smm_token') || '');
      localStorage.setItem('smm_token', result.token);
      location.href = '/painel.html';
    }
  };

  loaders.orders = async function () {
    const status = document.getElementById('o-filter').value;
    const data = await api('/api/admin/orders' + (status ? '?status=' + status : '') + '&limit=100');
    const rows = data.orders
      .map(
        (order) => `<tr>
        <td>${order.id}</td>
        <td>${esc(order.user_email)}</td>
        <td>${esc(order.service_name)}</td>
        <td class="font-mono" style="max-width:180px;overflow:hidden;text-overflow:ellipsis">${esc(order.link || '')}</td>
        <td>${order.quantity}</td>
        <td>${money(order.charge_cents)}</td>
        <td>${esc(order.status)}</td>
        <td>${esc(order.provider_name || '')}<br><span class="font-mono">${esc(order.remote_order_id || 'sem id remoto')}</span></td>
        <td>${order.remains ?? ''}</td>
        <td><button class="btn btn-ghost text-xs" onclick="retry(${order.id})">Reenviar</button> <button class="btn btn-danger text-xs" onclick="refundOrder(${order.id})">Estornar</button></td>
      </tr>`
      )
      .join('');
    document.getElementById('o-tbl').innerHTML = `<table><thead><tr><th>#</th><th>Cliente</th><th>Serviço</th><th>Link</th><th>Qtd</th><th>Valor</th><th>Status</th><th>Fornecedor</th><th>Resta</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
  };

  loaders.services = async function () {
    const [catalog, providers, categories] = await Promise.all([
      api('/api/admin/services'),
      api('/api/admin/providers'),
      api('/api/services/categories'),
    ]);
    const pane = document.getElementById('s-tbl');
    pane.textContent = '';
    const tools = document.createElement('div');
    tools.style.display = 'grid';
    tools.style.gap = '8px';
    tools.style.marginBottom = '12px';
    const providerOptions = providers.providers
      .map((provider) => `<option value="${provider.id}">${esc(provider.name)}${provider.is_mock ? ' (mock)' : ''}</option>`)
      .join('');
    const categoryOptions = categories.categories
      .map((category) => `<option value="${category.id}">${esc(category.name)}</option>`)
      .join('');
    tools.innerHTML = `<div style="display:flex;gap:8px;flex-wrap:wrap">
      <select id="sync-provider" class="select" style="max-width:240px">${providerOptions}</select>
      <input id="sync-markup" class="input" style="max-width:120px" type="number" value="200" placeholder="Margem %">
      <button class="btn btn-primary" id="sync-go" type="button">Sincronizar fornecedor</button>
      <button class="btn btn-ghost" id="markup-go" type="button">Aplicar margem</button>
      <button class="btn btn-ghost" id="service-new" type="button">Novo serviço</button>
      <button class="btn btn-ghost" id="category-new" type="button">Nova categoria</button>
    </div>
    <input id="service-search" class="input" placeholder="Filtrar serviço">`;
    pane.append(tools);
    const table = document.createElement('div');
    pane.append(table);
    const draw = (query = '') => {
      const list = catalog.services.filter((service) =>
        (service.name + service.platform).toLowerCase().includes(query.toLowerCase())
      );
      table.innerHTML = `<table><thead><tr><th>#</th><th>Nome</th><th>Plataforma</th><th>Custo/k</th><th>Preço/k</th><th>Status</th><th></th></tr></thead><tbody>${list
        .map(
          (service) => `<tr>
          <td>${service.id}</td><td>${esc(service.name)}</td><td>${esc(service.platform)}</td>
          <td>${money(service.cost_per_k_cents)}</td><td>${money(service.price_per_k_cents)}</td><td>${esc(service.status)}</td>
          <td><button class="btn btn-ghost text-xs" data-edit="${service.id}" type="button">Editar</button></td></tr>`
        )
        .join('')}</tbody></table>`;
      table.querySelectorAll('[data-edit]').forEach((button) => {
        button.onclick = () => editService(catalog.services.find((service) => service.id === Number(button.dataset.edit)));
      });
    };
    draw();
    document.getElementById('service-search').oninput = (event) => draw(event.target.value);
    document.getElementById('sync-go').onclick = () =>
      run(() =>
        api('/api/admin/services/sync-upstream', {
          method: 'POST',
          body: JSON.stringify({
            provider_id: Number(document.getElementById('sync-provider').value),
            markup_pct: Number(document.getElementById('sync-markup').value),
          }),
        })
      ).then((result) => result && loaders.services());
    document.getElementById('markup-go').onclick = () =>
      run(() =>
        api('/api/admin/services/bulk-markup', {
          method: 'POST',
          body: JSON.stringify({
            markup_pct: Number(document.getElementById('sync-markup').value),
            provider_id: Number(document.getElementById('sync-provider').value),
          }),
        })
      ).then((result) => result && loaders.services());
    document.getElementById('category-new').onclick = () => {
      const name = field('Nome', '');
      const platform = field('Plataforma (ex: instagram)', '');
      const icon = field('Ícone Font Awesome', 'fa-solid fa-tag');
      dialog('Nova categoria', [name.wrap, platform.wrap, icon.wrap], async (status) => {
        const result = await api('/api/admin/categories', {
          method: 'POST',
          body: JSON.stringify({ name: name.input.value, platform: platform.input.value, icon: icon.input.value }),
        });
        status.textContent = result.message;
        say(result.message);
      });
    };
    document.getElementById('service-new').onclick = () => {
      const name = field('Nome', '');
      const platform = field('Plataforma', 'instagram');
      const remote = field('ID no fornecedor', '');
      const cost = field('Custo por mil (centavos)', '100', 'number');
      const price = field('Preço por mil (centavos)', '300', 'number');
      const min = field('Mínimo', '100', 'number');
      const max = field('Máximo', '10000', 'number');
      const category = document.createElement('select');
      category.className = 'select';
      category.innerHTML = categoryOptions;
      const provider = document.createElement('select');
      provider.className = 'select';
      provider.innerHTML = providerOptions;
      const categoryLabel = document.createElement('label');
      categoryLabel.textContent = 'Categoria';
      categoryLabel.append(category);
      const providerLabel = document.createElement('label');
      providerLabel.textContent = 'Provedor';
      providerLabel.append(provider);
      dialog('Novo serviço', [name.wrap, platform.wrap, remote.wrap, categoryLabel, providerLabel, cost.wrap, price.wrap, min.wrap, max.wrap], async () => {
        const result = await api('/api/admin/services', {
          method: 'POST',
          body: JSON.stringify({
            name: name.input.value,
            platform: platform.input.value,
            provider_service_id: remote.input.value,
            category_id: Number(category.value),
            provider_id: Number(provider.value),
            cost_per_k_cents: Number(cost.input.value),
            price_per_k_cents: Number(price.input.value),
            min_quantity: Number(min.input.value),
            max_quantity: Number(max.input.value),
            refill_available: 1,
            dripfeed_available: 1,
            status: 'active',
          }),
        });
        say(result.message);
        await loaders.services();
      });
    };
    function editService(service) {
      const controls = {};
      const nodes = [];
      for (const [key, label, type] of [
        ['name', 'Nome', 'text'],
        ['cost_per_k_cents', 'Custo por mil (centavos)', 'number'],
        ['price_per_k_cents', 'Preço por mil (centavos)', 'number'],
        ['min_quantity', 'Mínimo', 'number'],
        ['max_quantity', 'Máximo', 'number'],
        ['status', 'Status (active ou inactive)', 'text'],
        ['description', 'Descrição', 'text'],
        ['backup_provider_id', 'Provedor reserva (id ou vazio)', 'text'],
        ['backup_service_id', 'Serviço reserva', 'text'],
      ]) {
        const item = field(label, service[key] ?? '', type);
        controls[key] = item.input;
        nodes.push(item.wrap);
      }
      const refill = document.createElement('input');
      refill.type = 'checkbox';
      refill.checked = !!service.refill_available;
      const refillLabel = document.createElement('label');
      refillLabel.append(refill, document.createTextNode(' Reposição disponível'));
      nodes.push(refillLabel);
      dialog('Editar serviço #' + service.id, nodes, async () => {
        const payload = { ...service, refill_available: refill.checked ? 1 : 0 };
        for (const [key, input] of Object.entries(controls)) payload[key] = input.value;
        const result = await api('/api/admin/services/' + service.id, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        say(result.message || 'Serviço atualizado.');
        await loaders.services();
      });
    }
  };

  loaders.providers = async function () {
    const data = await api('/api/admin/providers');
    const host = document.getElementById('p-tbl');
    host.textContent = '';
    const rate = document.createElement('div');
    rate.style.marginBottom = '12px';
    rate.innerHTML = `<div style="display:flex;gap:8px;flex-wrap:wrap"><input id="usd-rate" class="input" style="max-width:160px" type="number" step="0.01" placeholder="USD/BRL"><button class="btn btn-primary" id="usd-go" type="button">Atualizar taxa</button></div>`;
    host.append(rate);
    document.getElementById('usd-go').onclick = () =>
      run(() =>
        api('/api/admin/update-exchange-rate', {
          method: 'POST',
          body: JSON.stringify({ rate: Number(document.getElementById('usd-rate').value) }),
        })
      );
    const table = document.createElement('table');
    table.innerHTML = `<thead><tr><th>#</th><th>Nome</th><th>Saldo</th><th>Tipo</th><th>Status</th><th></th></tr></thead>`;
    const body = document.createElement('tbody');
    for (const provider of data.providers) {
      const row = document.createElement('tr');
      row.innerHTML = `<td>${provider.id}</td><td>${esc(provider.name)}</td><td>${esc(provider.currency)} ${Number(provider.balance_upstream || 0).toFixed(2)}</td><td>${provider.is_mock ? 'Mock — não entrega' : 'Real'}</td><td>${esc(provider.status)}</td><td></td>`;
      const cell = row.lastElementChild;
      const test = document.createElement('button');
      test.className = 'btn btn-ghost text-xs';
      test.textContent = 'Testar saldo';
      test.onclick = () => run(() => api('/api/admin/providers/' + provider.id + '/test-balance', { method: 'POST' })).then((result) => result && loaders.providers());
      const key = document.createElement('button');
      key.className = 'btn btn-ghost text-xs';
      key.textContent = 'Trocar chave';
      key.onclick = async () => {
        const apiKey = prompt('Nova chave do fornecedor');
        if (!apiKey) return;
        const result = await run(() =>
          api('/api/admin/providers/' + provider.id + '/update-key', {
            method: 'POST',
            body: JSON.stringify({ api_key: apiKey }),
          })
        );
        if (result) loaders.providers();
      };
      const remove = document.createElement('button');
      remove.className = 'btn btn-danger text-xs';
      remove.textContent = 'Desativar';
      remove.onclick = () =>
        run(() => api('/api/admin/providers/' + provider.id, { method: 'DELETE' })).then((result) => result && loaders.providers());
      cell.append(test, key, remove);
      body.append(row);
    }
    table.append(body);
    host.append(table);
    if (data.providers.every((provider) => provider.is_mock))
      say('Os fornecedores ativos são mock. Pedido local não sai para nenhuma rede.');
  };

  loaders.users = async function () {
    const search = document.getElementById('u-search').value;
    const data = await api('/api/admin/users' + (search ? '?search=' + encodeURIComponent(search) : ''));
    document.getElementById('u-tbl').innerHTML = `<table><thead><tr><th>#</th><th>Nome</th><th>E-mail</th><th>Saldo</th><th>Papel</th><th>Status</th><th></th></tr></thead><tbody>${data.users
      .map(
        (user) => `<tr><td>${user.id}</td><td>${esc(user.name)}</td><td>${esc(user.email)}</td><td>${money(user.balance_cents)}</td><td>${esc(user.role)}</td><td>${esc(user.status)}</td><td>
        <button class="btn btn-ghost text-xs" onclick="impersonate(${user.id})">Consultar</button>
        <button class="btn btn-ghost text-xs" data-user="${user.id}" data-act="status">${user.status === 'active' ? 'Suspender' : 'Reativar'}</button>
        <button class="btn btn-ghost text-xs" data-user="${user.id}" data-act="balance">Saldo</button>
        <button class="btn btn-ghost text-xs" data-user="${user.id}" data-act="note">Nota</button>
        <button class="btn btn-ghost text-xs" data-user="${user.id}" data-act="role">Papel</button>
      </td></tr>`
      )
      .join('')}</tbody></table>`;
    document.querySelectorAll('#u-tbl [data-act]').forEach((button) => {
      button.onclick = async () => {
        const id = button.dataset.user;
        if (button.dataset.act === 'status') {
          const next = button.textContent === 'Suspender' ? 'suspended' : 'active';
          const result = await run(() => api('/api/admin/users/' + id + '/status', { method: 'POST', body: JSON.stringify({ status: next }) }));
          if (result) loaders.users();
        }
        if (button.dataset.act === 'balance') {
          const amount = prompt('Valor em reais. Use negativo para debitar.');
          const reason = prompt('Motivo (mínimo 5 caracteres)');
          if (!amount || !reason) return;
          const result = await run(() =>
            api('/api/admin/users/' + id + '/adjust-balance', {
              method: 'POST',
              body: JSON.stringify({ amount_brl: Number(amount.replace(',', '.')), reason }),
            })
          );
          if (result) loaders.users();
        }
        if (button.dataset.act === 'note') {
          const note = prompt('Nota interna');
          if (!note) return;
          await run(() => api('/api/admin/users/' + id + '/notes', { method: 'POST', body: JSON.stringify({ note }) }));
        }
        if (button.dataset.act === 'role') {
          const role = prompt('Novo papel: user, vip, support, admin ou ceo');
          if (!role) return;
          const result = await run(() => api('/api/admin/users/' + id + '/role', { method: 'POST', body: JSON.stringify({ role }) }));
          if (result) loaders.users();
        }
      };
    });
  };

  loaders.tickets = async function () {
    const data = await api('/api/admin/tickets');
    const host = document.getElementById('t-tbl');
    host.textContent = '';
    const table = document.createElement('table');
    table.innerHTML = '<thead><tr><th>#</th><th>Assunto</th><th>Cliente</th><th>Status</th><th></th></tr></thead>';
    const body = document.createElement('tbody');
    for (const ticket of data.tickets) {
      const row = document.createElement('tr');
      row.innerHTML = `<td>${ticket.id}</td><td>${esc(ticket.subject)}</td><td>${esc(ticket.user_email)}</td><td>${esc(ticket.status)}</td><td></td>`;
      const reply = document.createElement('button');
      reply.className = 'btn btn-ghost text-xs';
      reply.textContent = 'Responder';
      reply.onclick = async () => {
        const detail = await api('/api/admin/tickets/' + ticket.id);
        const message = prompt((detail.messages || []).map((item) => item.sender_name + ': ' + item.message).join('\n') + '\n\nResposta:');
        if (!message) return;
        const close = confirm('Fechar o chamado depois da resposta?');
        const result = await run(() =>
          api('/api/admin/tickets/' + ticket.id + '/reply', {
            method: 'POST',
            body: JSON.stringify({ message, close }),
          })
        );
        if (result) loaders.tickets();
      };
      row.lastElementChild.append(reply);
      body.append(row);
    }
    table.append(body);
    host.append(table);
  };

  const originalCoupons = loadCoupons;
  loadCoupons = async function () {
    const data = await api('/api/admin/coupons');
    document.getElementById('cp-tbl').innerHTML = `<table><thead><tr><th>Código</th><th>%</th><th>Fixo</th><th>Mínimo</th><th>Usos</th><th>Status</th><th></th></tr></thead><tbody>${data.coupons
      .map(
        (coupon) => `<tr><td class="font-mono">${esc(coupon.code)}</td><td>${coupon.discount_pct}%</td><td>${money(coupon.fixed_cents)}</td><td>${money(coupon.min_order_cents)}</td><td>${coupon.uses_count}/${coupon.max_uses}</td><td>${esc(coupon.status)}</td><td>
        <button class="btn btn-ghost text-xs" data-coupon="${coupon.id}" data-act="pause">${coupon.status === 'active' ? 'Pausar' : 'Ativar'}</button>
        <button class="btn btn-danger text-xs" onclick="delCoupon(${coupon.id})">×</button></td></tr>`
      )
      .join('')}</tbody></table>`;
    document.querySelectorAll('#cp-tbl [data-act="pause"]').forEach((button) => {
      button.onclick = async () => {
        const coupon = data.coupons.find((item) => item.id === Number(button.dataset.coupon));
        const result = await run(() =>
          api('/api/admin/coupons/' + coupon.id, {
            method: 'PUT',
            body: JSON.stringify({ ...coupon, status: coupon.status === 'active' ? 'inactive' : 'active' }),
          })
        );
        if (result) loadCoupons();
      };
    });
  };
  loaders.coupons = loadCoupons;

  loadAnnouncements = async function () {
    const data = await api('/api/admin/announcements');
    document.getElementById('an-list').innerHTML = `<table><thead><tr><th>#</th><th>Título</th><th>Ativo</th><th></th></tr></thead><tbody>${data.announcements
      .map(
        (item) => `<tr><td>${item.id}</td><td>${esc(item.title)}</td><td>${item.is_active ? 'sim' : 'não'}</td><td>
        <button class="btn btn-ghost text-xs" data-ann="${item.id}">${item.is_active ? 'Desligar' : 'Ligar'}</button>
        <button class="btn btn-ghost text-xs" data-edit-ann="${item.id}">Editar</button>
        <button class="btn btn-danger text-xs" onclick="delAnn(${item.id})">×</button></td></tr>`
      )
      .join('')}</tbody></table>`;
    document.querySelectorAll('[data-ann]').forEach((button) => {
      button.onclick = async () => {
        const item = data.announcements.find((row) => row.id === Number(button.dataset.ann));
        const result = await run(() =>
          api('/api/admin/announcements/' + item.id, {
            method: 'PUT',
            body: JSON.stringify({ ...item, is_active: item.is_active ? 0 : 1 }),
          })
        );
        if (result) loadAnnouncements();
      };
    });
    document.querySelectorAll('[data-edit-ann]').forEach((button) => {
      button.onclick = () => {
        const item = data.announcements.find((row) => row.id === Number(button.dataset.editAnn));
        const title = field('Título', item.title);
        const message = field('Mensagem', item.message);
        const badge = field('Selo', item.badge || '');
        dialog('Editar anúncio', [title.wrap, message.wrap, badge.wrap], async () => {
          await api('/api/admin/announcements/' + item.id, {
            method: 'PUT',
            body: JSON.stringify({ title: title.input.value, message: message.input.value, badge: badge.input.value, is_active: item.is_active }),
          });
          await loadAnnouncements();
        });
      };
    });
  };
  loaders.announcements = loadAnnouncements;

  loaders.platforms = async function () {
    const data = await api('/api/site/admin/platforms');
    const host = document.getElementById('pf-list');
    host.textContent = '';
    const table = document.createElement('table');
    table.innerHTML = '<thead><tr><th>Nome</th><th>Ordem</th><th>Visível</th><th></th></tr></thead>';
    const body = document.createElement('tbody');
    for (const platform of data.platforms) {
      const row = document.createElement('tr');
      row.innerHTML = `<td>${esc(platform.name)}</td><td>${platform.display_order}</td><td>${platform.is_visible ? 'sim' : 'não'}</td><td></td>`;
      const edit = document.createElement('button');
      edit.className = 'btn btn-ghost text-xs';
      edit.textContent = 'Editar';
      edit.onclick = () => {
        const name = field('Nome', platform.name);
        const icon = field('Ícone', platform.icon);
        const color = field('Cor', platform.color);
        const order = field('Ordem', platform.display_order, 'number');
        const description = field('Descrição', platform.description || '');
        const visible = document.createElement('input');
        visible.type = 'checkbox';
        visible.checked = !!platform.is_visible;
        const visibleLabel = document.createElement('label');
        visibleLabel.append(visible, document.createTextNode(' Visível na vitrine'));
        dialog(platform.name, [name.wrap, icon.wrap, color.wrap, order.wrap, description.wrap, visibleLabel], async () => {
          await api('/api/site/admin/platforms/' + platform.id, {
            method: 'PUT',
            body: JSON.stringify({
              name: name.input.value,
              icon: icon.input.value,
              color: color.input.value,
              display_order: Number(order.input.value),
              description: description.input.value,
              is_visible: visible.checked ? 1 : 0,
            }),
          });
          await loaders.platforms();
        });
      };
      row.lastElementChild.append(edit);
      body.append(row);
    }
    table.append(body);
    host.append(table);
  };

  loaders.payments = async function () {
    const data = await api('/api/site/admin/payment-methods');
    const host = document.getElementById('pm-list');
    host.textContent = '';
    const note = document.createElement('p');
    note.textContent = 'Boleto e cartão não estão implementados. Pix e cripto só aparecem na vitrine depois da homologação do gateway.';
    host.append(note);
    const table = document.createElement('table');
    table.innerHTML = '<thead><tr><th>Método</th><th>Mínimo</th><th>Máximo</th><th>Ligado</th><th></th></tr></thead>';
    const body = document.createElement('tbody');
    for (const method of data.methods) {
      const row = document.createElement('tr');
      row.innerHTML = `<td>${esc(method.label)}</td><td>${money(method.min_amount_cents)}</td><td>${money(method.max_amount_cents)}</td><td>${method.is_enabled ? 'sim' : 'não'}</td><td></td>`;
      const toggle = document.createElement('button');
      toggle.className = 'btn btn-ghost text-xs';
      toggle.textContent = method.is_enabled ? 'Desligar' : 'Ligar';
      toggle.onclick = () =>
        run(() =>
          api('/api/site/admin/payment-methods/' + method.id, {
            method: 'PUT',
            body: JSON.stringify({
              is_enabled: method.is_enabled ? 0 : 1,
              display_order: method.display_order,
              label: method.label,
              description: method.description || '',
              min_amount_cents: method.min_amount_cents,
              max_amount_cents: method.max_amount_cents,
            }),
          })
        ).then((result) => result && loaders.payments());
      row.lastElementChild.append(toggle);
      body.append(row);
    }
    table.append(body);
    host.append(table);
  };

  loaders.blog = async function () {
    const data = await api('/api/admin/blog');
    const host = document.getElementById('bl-list');
    host.textContent = '';
    const create = document.createElement('button');
    create.className = 'btn btn-primary';
    create.textContent = 'Novo post';
    create.onclick = () => {
      const title = field('Título', '');
      const category = field('Categoria', 'Geral');
      const content = field('Texto', '');
      dialog('Novo post', [title.wrap, category.wrap, content.wrap], async () => {
        await api('/api/admin/blog', {
          method: 'POST',
          body: JSON.stringify({ title: title.input.value, category: category.input.value, content: content.input.value }),
        });
        await loaders.blog();
      });
    };
    host.append(create);
    const table = document.createElement('table');
    table.innerHTML = '<thead><tr><th>Título</th><th>Categoria</th><th></th></tr></thead>';
    const body = document.createElement('tbody');
    for (const post of data.posts) {
      const row = document.createElement('tr');
      row.innerHTML = `<td>${esc(post.title)}</td><td>${esc(post.category)}</td><td></td>`;
      const remove = document.createElement('button');
      remove.className = 'btn btn-danger text-xs';
      remove.textContent = 'Remover';
      remove.onclick = () =>
        run(() => api('/api/admin/blog/' + post.id, { method: 'DELETE' })).then((result) => result && loaders.blog());
      const edit = document.createElement('button');
      edit.className = 'btn btn-ghost text-xs';
      edit.textContent = 'Editar';
      edit.onclick = async () => {
        const full = await fetch('/api/blog/' + encodeURIComponent(post.slug)).then((response) => response.json());
        const title = field('Título', full.post.title);
        const category = field('Categoria', full.post.category);
        const content = field('Texto', full.post.content);
        dialog('Editar post', [title.wrap, category.wrap, content.wrap], async () => {
          await api('/api/admin/blog/' + post.id, {
            method: 'PUT',
            body: JSON.stringify({ title: title.input.value, category: category.input.value, content: content.input.value }),
          });
          await loaders.blog();
        });
      };
      row.lastElementChild.append(edit, remove);
      body.append(row);
    }
    table.append(body);
    host.append(table);
  };

  loaders.giveaways = async function () {
    const pane = document.getElementById('pane-giveaways');
    const form = pane.querySelector('.card');
    const data = await api('/api/admin/operations/giveaways');
    let list = pane.querySelector('#giveaway-list');
    if (!list) {
      list = document.createElement('div');
      list.id = 'giveaway-list';
      pane.append(list);
    }
    list.innerHTML = data.rows.length
      ? `<table><thead><tr><th>#</th><th>Título</th><th>Prêmio</th><th>Status</th><th></th></tr></thead><tbody>${data.rows
          .map(
            (row) => `<tr><td>${row.id}</td><td>${esc(row.title)}</td><td>${money(row.prize_cents)}</td><td>${esc(row.status)}</td><td>${row.status === 'open' ? `<button class="btn btn-primary text-xs" data-draw="${row.id}" type="button">Sortear</button>` : ''}</td></tr>`
          )
          .join('')}</tbody></table>`
      : '<p>Nenhum sorteio ainda. O formulário acima grava em reais.</p>';
    list.querySelectorAll('[data-draw]').forEach((button) => {
      button.onclick = () =>
        run(() => api('/api/engagement/giveaways/' + button.dataset.draw + '/draw', { method: 'POST' })).then((result) => result && loaders.giveaways());
    });
    if (form) form.hidden = false;
  };

  loaders.challenges = async function () {
    const pane = document.getElementById('pane-challenges');
    pane.textContent = '';
    const create = document.createElement('button');
    create.className = 'btn btn-primary';
    create.textContent = 'Novo desafio';
    create.onclick = () => {
      const title = field('Título', '');
      const month = field('Mês (AAAA-MM)', new Date().toISOString().slice(0, 7));
      const type = field('Tipo: spend_cents ou orders_count', 'orders_count');
      const target = field('Meta', '5', 'number');
      const prize = field('Prêmio (centavos)', '500', 'number');
      dialog('Novo desafio', [title.wrap, month.wrap, type.wrap, target.wrap, prize.wrap], async () => {
        await api('/api/admin/challenges', {
          method: 'POST',
          body: JSON.stringify({
            title: title.input.value,
            month: month.input.value,
            target_type: type.input.value,
            target_value: Number(target.input.value),
            prize_pool_cents: Number(prize.input.value),
          }),
        });
        await loaders.challenges();
      });
    };
    pane.append(create);
    const data = await api('/api/admin/operations/challenges');
    const table = document.createElement('table');
    table.innerHTML = '<thead><tr><th>#</th><th>Título</th><th>Mês</th><th>Status</th><th></th></tr></thead>';
    const body = document.createElement('tbody');
    for (const row of data.rows) {
      const line = document.createElement('tr');
      line.innerHTML = `<td>${row.id}</td><td>${esc(row.title)}</td><td>${esc(row.month)}</td><td>${esc(row.status)}</td><td></td>`;
      if (row.status === 'open') {
        const close = document.createElement('button');
        close.className = 'btn btn-ghost text-xs';
        close.textContent = 'Encerrar';
        close.onclick = () =>
          run(() => api('/api/admin/challenges/' + row.id + '/close', { method: 'POST' })).then((result) => result && loaders.challenges());
        line.lastElementChild.append(close);
      }
      body.append(line);
    }
    if (!data.rows.length) {
      const line = document.createElement('tr');
      line.innerHTML = '<td colspan="5">Nenhum desafio criado.</td>';
      body.append(line);
    }
    table.append(body);
    pane.append(table);
  };

  loaders.scheduled = async function () {
    const data = await api('/api/admin/scheduled');
    const host = document.getElementById('sch-tbl');
    host.textContent = '';
    const table = document.createElement('table');
    table.innerHTML = '<thead><tr><th>#</th><th>Cliente</th><th>Serviço</th><th>Quando</th><th>Status</th><th></th></tr></thead>';
    const body = document.createElement('tbody');
    for (const row of data.rows) {
      const line = document.createElement('tr');
      line.innerHTML = `<td>${row.id}</td><td>${esc(row.user_email)}</td><td>${esc(row.service_name)}<br>${esc(row.link)}</td><td>${esc(row.run_at)}</td><td>${esc(row.status)}</td><td></td>`;
      if (row.status === 'pending') {
        const cancel = document.createElement('button');
        cancel.className = 'btn btn-danger text-xs';
        cancel.textContent = 'Cancelar';
        cancel.onclick = () =>
          run(() => api('/api/admin/scheduled/' + row.id + '/cancel', { method: 'POST' })).then((result) => result && loaders.scheduled());
        line.lastElementChild.append(cancel);
      }
      body.append(line);
    }
    if (!data.rows.length) {
      const line = document.createElement('tr');
      line.innerHTML = '<td colspan="6">Nenhum agendamento.</td>';
      body.append(line);
    }
    table.append(body);
    host.append(table);
  };

  loaders.invoices = async function () {
    const pane = document.getElementById('pane-invoices');
    pane.textContent = 'Nota fiscal ainda não tem emissor. Um comprovante do painel não substitui NF. Este item fica só como aviso até a empresa e a integração existirem.';
  };

  const originalSnapshots = loadSnapshots;
  loadSnapshots = async function () {
    await originalSnapshots();
    const host = document.getElementById('sn-tbl');
    if (host.querySelector('#snap-go')) return;
    const button = document.createElement('button');
    button.id = 'snap-go';
    button.className = 'btn btn-primary';
    button.textContent = 'Fotografar agora';
    button.onclick = () =>
      run(() => api('/api/admin/snapshots/capture', { method: 'POST' })).then((result) => result && loadSnapshots());
    host.prepend(button);
    const note = document.createElement('p');
    note.textContent = 'O lucro desta fotografia é estimado e não inclui a taxa real liquidada pelo fornecedor.';
    host.prepend(note);
  };
  loaders.snapshots = loadSnapshots;

  loaders.lgpd = async function () {
    const data = await api('/api/admin/lgpd/requests');
    const host = document.getElementById('lg-tbl');
    host.textContent = data.requests.length ? '' : 'Sem pedidos LGPD.';
    if (!data.requests.length) return;
    const table = document.createElement('table');
    table.innerHTML = '<thead><tr><th>#</th><th>Cliente</th><th>Tipo</th><th>Status</th><th></th></tr></thead>';
    const body = document.createElement('tbody');
    for (const request of data.requests) {
      const row = document.createElement('tr');
      row.innerHTML = `<td>${request.id}</td><td>${esc(request.email)}</td><td>${esc(request.type)}</td><td>${esc(request.status)}</td><td></td>`;
      for (const [status, label, note] of [
        ['completed', 'Concluir', 'Atendido no admin'],
        ['rejected', 'Rejeitar', 'Recusado no admin'],
        ['pending', 'Reabrir', 'Voltou para a fila'],
      ]) {
        const action = document.createElement('button');
        action.className = 'btn btn-ghost text-xs';
        action.textContent = label;
        action.onclick = () =>
          run(() =>
            api('/api/admin/lgpd/requests/' + request.id + '/status', {
              method: 'POST',
              body: JSON.stringify({ status, note }),
            })
          ).then((result) => result && loaders.lgpd());
        row.lastElementChild.append(action);
      }
      body.append(row);
    }
    table.append(body);
    host.append(table);
  };

  loaders.affiliates = async function () {
    const [list, summary] = await Promise.all([
      api('/api/admin/affiliates'),
      api('/api/admin/affiliates/summary'),
    ]);
    const rates = summary.rates || {};
    document.getElementById('af-tbl').innerHTML = `<p>Comissões lançadas: ${money(summary.commission_cents)} em ${summary.entries} registros. Não há baixa de pagamento nesta tabela — o valor fica na carteira de quem indicou no momento do depósito.</p><p>Percentuais: L1 ${esc(rates.affiliate_l1_pct || '—')}% · L2 ${esc(rates.affiliate_l2_pct || '—')}% · L3 ${esc(rates.affiliate_l3_pct || '—')}% · L4 ${esc(rates.affiliate_l4_pct || '—')}%</p><table><thead><tr><th>#</th><th>Nível</th><th>Afiliado</th><th>Indicado</th><th>Comissão</th></tr></thead><tbody>${list.affiliates
      .map(
        (row) => `<tr><td>${row.id}</td><td>L${row.level}</td><td>${esc(row.referrer_email)}</td><td>${esc(row.buyer_email)}</td><td>${money(row.commission_cents)}</td></tr>`
      )
      .join('')}</tbody></table>`;
  };

  const backup = document.createElement('button');
  backup.className = 'btn btn-ghost';
  backup.type = 'button';
  backup.textContent = 'Baixar backup do banco';
  backup.style.marginTop = '12px';
  backup.onclick = async () => {
    try {
      const response = await fetch('/api/admin/backup-db', { headers: { Authorization: 'Bearer ' + localStorage.getItem('smm_token') } });
      if (!response.ok) throw new Error('Backup recusado.');
      const blob = await response.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'smmhub-backup.sqlite';
      link.click();
      say('Backup gerado. Guarde a cópia fora da VPS.');
    } catch (error) {
      say(error.message);
    }
  };
  document.getElementById('pane-settings')?.append(backup);
  void originalDash;
  void originalCoupons;
})();
