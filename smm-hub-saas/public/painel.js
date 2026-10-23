(() => {
  const money = (value) =>
    new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(Number(value || 0) / 100);
  const number = (value) => Number(value || 0).toLocaleString('pt-BR');
  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const empty = (container, message) =>
    container.replaceChildren(element('p', message, 'empty-state'));
  const statuses = {
    pending: 'Na fila',
    dispatching: 'Enviando',
    processing: 'Processando',
    in_progress: 'Em andamento',
    completed: 'Concluído',
    partial: 'Parcial',
    failed: 'Falhou',
    canceled: 'Cancelado',
    awaiting_confirmation: 'Em confirmação',
  };
  function statusName(value) {
    return Object.hasOwn(statuses, value)
      ? statuses[value]
      : 'Em acompanhamento';
  }
  function date(value) {
    return new Date(
      value.includes('T') ? value : value.replace(' ', 'T') + 'Z',
    ).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  function attention(container, rows) {
    const block = document.getElementById('order-attention-block');
    if (!container || !block) return;
    if (!rows.length) {
      block.hidden = true;
      container.replaceChildren();
      return;
    }
    block.hidden = false;
    container.replaceChildren();
    for (const item of rows) {
      const button = element('button', item.title, 'text-action');
      button.type = 'button';
      button.style.display = 'block';
      button.style.margin = '6px 0';
      button.onclick = () => navigateTo(item.view || 'orders');
      container.append(button);
    }
  }
  function orders(container, rows) {
    if (!rows.length) {
      empty(
        container,
        'Você ainda não fez pedidos. Comece sua primeira campanha em Novo pedido.',
      );
      return;
    }
    const wrap = element('div', null, 'orders-table-wrap'),
      table = element('table'),
      head = element('thead'),
      tr = element('tr');
    for (const label of ['Pedido', 'Serviço', 'Valor', 'Status'])
      tr.append(element('th', label));
    head.append(tr);
    const body = element('tbody');
    for (const order of rows) {
      const row = element('tr');
      row.append(
        element('td', '#' + order.id),
        element('td', order.service_name),
        element('td', money(order.charge_cents)),
      );
      const cell = element('td');
      cell.append(
        element(
          'span',
          statusName(order.status),
          'status-pill ' + order.status,
        ),
      );
      row.append(cell);
      body.append(row);
    }
    table.append(head, body);
    wrap.append(table);
    container.replaceChildren(wrap);
  }
  function activity(container, rows) {
    if (!rows.length) {
      empty(
        container,
        'As compras aparecerão aqui assim que forem registradas.',
      );
      return;
    }
    container.replaceChildren();
    for (const order of rows) {
      const row = element('div', null, 'activity-row'),
        icon = element('span', '↗', 'activity-icon'),
        content = element('div');
      content.append(
        element('strong', number(order.quantity) + ' · ' + order.service_name),
        element('small', date(order.created_at)),
      );
      row.append(icon, content);
      container.append(row);
    }
  }
  function comboCard(combo) {
    const card = element('article', null, 'combo-card');
    card.append(
      element('span', 'COMBO ATIVO', 'combo-badge'),
      element('h3', combo.name),
    );
    if (combo.description) card.append(element('p', combo.description));
    const list = element('ul');
    for (const item of combo.items)
      list.append(
        element('li', number(item.quantity) + ' · ' + item.service_name),
      );
    card.append(list);
    const price = element('div', null, 'combo-price');
    if (combo.regular_cents > combo.price_cents)
      price.append(element('del', money(combo.regular_cents)));
    price.append(document.createTextNode(money(combo.price_cents)));
    const button = element(
      'button',
      'Escolher combo ↗',
      'brand-btn brand-btn-solid',
    );
    button.type = 'button';
    button.onclick = () => openCombo(combo);
    card.append(price, button);
    return card;
  }
  function showCombos(container, combos) {
    if (!combos.length) {
      empty(
        container,
        'Nenhuma promoção ativa no momento. Novos combos aparecerão aqui quando forem publicados.',
      );
      return;
    }
    container.replaceChildren(...combos.map(comboCard));
  }
  function openCombo(combo) {
    const dialog = element('dialog', null, 'combo-dialog'),
      form = element('form'),
      title = element('h2', combo.name),
      description = element(
        'p',
        'Informe o destino de cada item. Valor total: ' +
          money(combo.price_cents) +
          '. O saldo será debitado ao confirmar.',
      );
    title.id = 'combo-dialog-title';
    dialog.setAttribute('aria-labelledby', title.id);
    form.append(title, description);
    const inputs = [];
    for (const item of combo.items) {
      const label = element(
          'label',
          number(item.quantity) + ' · ' + item.service_name,
        ),
        input = element('input');
      input.type = 'url';
      input.required = true;
      input.maxLength = 2048;
      input.className = 'brand-input';
      input.placeholder = 'https://';
      label.append(input);
      inputs.push(input);
      form.append(label);
    }
    const feedback = element('p');
    feedback.setAttribute('role', 'status');
    const buttons = element('div', null, 'dialog-actions'),
      cancel = element('button', 'Cancelar', 'brand-btn brand-btn-ghost'),
      submit = element(
        'button',
        'Confirmar ' + money(combo.price_cents),
        'brand-btn brand-btn-solid',
      );
    cancel.type = 'button';
    cancel.onclick = () => dialog.close();
    submit.type = 'submit';
    buttons.append(cancel, submit);
    form.append(feedback, buttons);
    dialog.append(form);
    document.body.append(dialog);
    dialog.onclose = () => dialog.remove();
    const requestId = crypto.randomUUID();
    form.onsubmit = async (event) => {
      event.preventDefault();
      submit.disabled = true;
      cancel.disabled = true;
      try {
        const data = await apiCall(
          '/api/combos/' + combo.id + '/purchase',
          'POST',
          {
            request_id: requestId,
            links: inputs.map((input) => input.value.trim()),
          },
        );
        state.user.balance_cents = data.new_balance_cents;
        updateUserUI();
        dialog.close();
        showToast(data.message, 'success');
        navigateTo('orders');
      } catch (error) {
        feedback.textContent = error.message;
      } finally {
        submit.disabled = false;
        cancel.disabled = false;
      }
    };
    dialog.showModal();
    inputs[0]?.focus();
  }
  let sharedComboOpened = false;
  window.loadPanelCombos = async () => {
    const container = document.getElementById('all-combos');
    empty(container, 'Carregando promoções…');
    try {
      const data = await apiCall('/api/combos');
      showCombos(container, data.combos);
      const id = Number(new URLSearchParams(location.search).get('combo')),
        shared = data.combos.find((combo) => combo.id === id);
      if (shared && !sharedComboOpened) {
        sharedComboOpened = true;
        openCombo(shared);
      }
    } catch (error) {
      empty(container, error.message);
    }
  };
  window.loadPanelDashboard = async () => {
    const feedback = document.getElementById('dashboard-feedback');
    feedback.textContent = '';
    if (state.user)
      document.getElementById('dashboard-greeting').textContent =
        'Olá, ' + state.user.name.split(' ')[0] + '. ';
    try {
      const data = await apiCall('/api/dashboard');
      document.getElementById('metric-my-orders').textContent = number(
        data.account.total_orders,
      );
      document.getElementById('metric-active-orders').textContent = number(
        data.account.active_orders,
      );
      document.getElementById('metric-total-orders').textContent = number(
        data.global.total_orders,
      );
      document.getElementById('metric-services').textContent = number(
        data.global.active_services,
      );
      document.getElementById('metric-today').textContent =
        number(data.global.orders_today) + ' registrados hoje';
      orders(document.getElementById('dashboard-orders'), data.recent_orders);
      attention(document.getElementById('order-attention'), data.attention || []);
      activity(document.getElementById('dashboard-activity'), data.activity);
    } catch (error) {
      feedback.textContent =
        'Não foi possível atualizar o resumo: ' + error.message;
    }
    try {
      const data = await apiCall('/api/combos');
      showCombos(
        document.getElementById('dashboard-combos'),
        data.combos.slice(0, 2),
      );
    } catch (error) {
      empty(
        document.getElementById('dashboard-combos'),
        'Não foi possível carregar as promoções.',
      );
    }
  };
  document.addEventListener('click', (event) => {
    const control = event.target.closest(
      '[data-navigate],.nav-link[data-view]',
    );
    if (!control) return;
    event.preventDefault();
    navigateTo(control.dataset.navigate || control.dataset.view);
    document
      .getElementById('btn-toggle-sidebar')
      .setAttribute('aria-expanded', 'false');
  });
  document.getElementById('panel-logout').onclick = () => logout();
  document.getElementById('order-comments-input').addEventListener('input',calculateOrderPrice);
  document
    .getElementById('order-link-input')
    .addEventListener('input', calculateOrderPrice);
  document
    .getElementById('btn-toggle-sidebar')
    .addEventListener('click', () =>
      requestAnimationFrame(() =>
        document
          .getElementById('btn-toggle-sidebar')
          .setAttribute(
            'aria-expanded',
            String(
              !document
                .getElementById('main-sidebar')
                .classList.contains('-translate-x-full'),
            ),
          ),
      ),
    );
  document
    .getElementById('btn-user-menu')
    .addEventListener('click', () =>
      requestAnimationFrame(() =>
        document
          .getElementById('btn-user-menu')
          .setAttribute(
            'aria-expanded',
            String(
              !document
                .getElementById('user-dropdown')
                .classList.contains('hidden'),
            ),
          ),
      ),
    );
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      document
        .getElementById('main-sidebar')
        .classList.add('-translate-x-full');
      document.getElementById('user-dropdown').classList.add('hidden');
    }
  });
  document.addEventListener('DOMContentLoaded', () => {
    const drip = document.getElementById('order-dripfeed-toggle');
    if (drip && !document.getElementById('drip-note')) {
      const note = document.createElement('p');
      note.id = 'drip-note';
      note.textContent = 'A entrega parcelada divide a quantidade em lotes. O lote seguinte só sai depois do intervalo, se o anterior concluir.';
      drip.closest('div')?.append(note);
    }
    const timer = setInterval(() => {
      if (state.currentView === 'dashboard' && state.user && !document.hidden)
        window.loadPanelDashboard();
      if (state.user && ['support', 'admin', 'ceo'].includes(state.user.role))
        document
          .getElementById('support-nav-section')
          .classList.remove('hidden');
    }, 60000);
    window.addEventListener('pagehide', () => clearInterval(timer), {
      once: true,
    });
  });
})();
