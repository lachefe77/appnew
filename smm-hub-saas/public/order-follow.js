(() => {
  const names = {
    pending: 'Pendente',
    dispatching: 'Enviando',
    processing: 'Processando',
    in_progress: 'Em andamento',
    completed: 'Concluído',
    partial: 'Parcial',
    failed: 'Falhou',
    canceled: 'Cancelado',
    awaiting_confirmation: 'Em confirmação',
  };

  function line(tag, text) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    return node;
  }

  async function quiet(path, method, body) {
    const response = await fetch(path, {
      method: method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + state.token,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Não foi possível atualizar.');
    return data;
  }

  function ensureNotices() {
    if (document.getElementById('order-notices')) return;
    const body = document.getElementById('orders-table-body');
    const host = document.createElement('div');
    host.id = 'order-notices';
    host.style.marginBottom = '12px';
    body?.closest('section,div')?.before(host);
  }

  async function paintNotices() {
    ensureNotices();
    const host = document.getElementById('order-notices');
    if (!host || !state.token) return;
    try {
      const data = await quiet('/api/orders/notices');
      host.replaceChildren();
      for (const notice of (data.notices || []).filter((item) => !item.read_at).slice(0, 4))
        host.append(line('p', 'Pedido #' + notice.order_id + ' · ' + notice.message));
    } catch {}
  }

  async function openFicha(id) {
    const data = await apiCall('/api/orders/' + id);
    const order = data.order;
    const dialog = document.createElement('dialog');
    dialog.className = 'combo-dialog';
    dialog.append(
      line('h2', 'Pedido #' + order.id),
      line(
        'p',
        (names[order.status] || order.status) +
          ' · entregue ' +
          Number(order.delivered || 0).toLocaleString('pt-BR') +
          ' de ' +
          Number(order.quantity).toLocaleString('pt-BR')
      ),
      line('p', order.service_name + ' · ' + order.link)
    );
    if (order.notices?.length) {
      dialog.append(line('h3', 'Atualizações'));
      for (const notice of order.notices)
        dialog.append(line('p', notice.message));
    }
    if (order.batches?.length) {
      dialog.append(line('h3', 'Lotes'));
      for (const batch of order.batches)
        dialog.append(
          line(
            'p',
            'Lote ' +
              batch.run +
              ' · ' +
              batch.status +
              ' · falta ' +
              batch.remains
          )
        );
    }
    if (order.refills?.length) {
      dialog.append(line('h3', 'Reposições'));
      for (const refill of order.refills)
        dialog.append(line('p', 'Reposição #' + refill.id + ' · ' + refill.status));
    }
    const actions = document.createElement('div');
    actions.className = 'dialog-actions';
    if (order.status === 'pending' && order.cancel_available) {
      const cancel = line('button', 'Cancelar pedido');
      cancel.type = 'button';
      cancel.className = 'brand-btn';
      cancel.onclick = () => cancelOrder(order.id, dialog);
      actions.append(cancel);
    }
    const again = line('button', 'Pedir de novo');
    again.type = 'button';
    again.className = 'brand-btn';
    again.onclick = () => reorder(order.id, dialog);
    const close = line('button', 'Fechar');
    close.type = 'button';
    close.className = 'brand-btn brand-btn-ghost';
    close.onclick = () => dialog.close();
    actions.append(again, close);
    dialog.append(actions);
    document.body.append(dialog);
    dialog.onclose = () => dialog.remove();
    dialog.showModal();
  }

  async function cancelOrder(id, dialog) {
    const data = await apiCall('/api/orders/' + id + '/cancel', 'POST');
    if (Number.isSafeInteger(data.new_balance_cents))
      state.user.balance_cents = data.new_balance_cents;
    updateUserUI();
    showToast(data.message, 'success');
    dialog?.close();
    loadUserOrders(false);
  }

  async function reorder(id, dialog) {
    const data = await apiCall('/api/orders/' + id + '/reorder', 'POST');
    if (Number.isSafeInteger(data.new_balance_cents))
      state.user.balance_cents = data.new_balance_cents;
    updateUserUI();
    showToast('Novo pedido #' + data.order.id + ' criado.', 'success');
    dialog?.close();
    navigateTo('orders');
  }

  function massTools() {
    const submit = document.getElementById('btn-submit-mass');
    const area = document.getElementById('mass-order-textarea');
    if (!submit || !area || document.getElementById('btn-preview-mass')) return;
    const check = line('button', 'Conferir cada linha');
    check.type = 'button';
    check.id = 'btn-preview-mass';
    check.className = submit.className;
    check.style.marginBottom = '8px';
    const report = document.createElement('div');
    report.id = 'mass-line-report';
    report.style.margin = '8px 0';
    submit.before(check, report);
    check.onclick = async () => {
      report.replaceChildren();
      try {
        const data = await apiCall('/api/orders/mass/preview', 'POST', {
          raw_text: area.value,
        });
        const good = [];
        for (const item of data.lines) {
          report.append(
            line(
              'p',
              item.ok
                ? 'Linha ' + item.line + ' · ' + item.service_name + ' · ' + formatPrice(item.charge_cents)
                : 'Linha ' + item.line + ' · ' + item.error
            )
          );
          if (item.ok)
            good.push({
              service_id: item.service_id,
              quantity: item.quantity,
              link: item.link,
            });
        }
        if (good.length && good.length < data.lines.length) {
          const send = line('button', 'Enviar só as linhas válidas');
          send.type = 'button';
          send.className = 'brand-btn';
          send.onclick = async () => {
            const created = await apiCall('/api/orders/mass/lines', 'POST', { lines: good });
            if (Number.isSafeInteger(created.new_balance_cents))
              state.user.balance_cents = created.new_balance_cents;
            updateUserUI();
            showToast(created.created_count + ' pedidos criados.', 'success');
            area.value = '';
            navigateTo('orders');
          };
          report.append(send);
        }
      } catch {}
    };
  }

  async function showFavorites() {
    const select = document.getElementById('order-service-select');
    if (!select || !state.token) return;
    let host = document.getElementById('favorite-services');
    if (!host) {
      host = document.createElement('div');
      host.id = 'favorite-services';
      host.style.display = 'flex';
      host.style.flexWrap = 'wrap';
      host.style.gap = '8px';
      host.style.margin = '8px 0';
      select.before(host);
    }
    try {
      const data = await quiet('/api/services/favorites');
      host.replaceChildren();
      for (const service of data.favorites || []) {
        const chip = line('button', service.name);
        chip.type = 'button';
        chip.className = 'brand-btn brand-btn-ghost brand-btn-sm';
        chip.onclick = () => {
          select.value = String(service.id);
          onServiceChanged();
        };
        host.append(chip);
      }
    } catch {}
  }

  async function showClients() {
    const view = document.getElementById('view-agency');
    if (!view || !state.token) return;
    let box = document.getElementById('agency-clients');
    if (!box) {
      box = document.createElement('section');
      box.id = 'agency-clients';
      box.className = 'card-cyber rounded-2xl p-6 border border-gray-800 space-y-3';
      view.append(box);
    }
    box.replaceChildren(line('h3', 'Clientes da agência'));
    const name = document.createElement('input');
    name.className = 'bg-gray-900 border border-gray-700 rounded-xl px-3 py-2 text-xs text-white';
    name.placeholder = 'Nome do cliente';
    name.maxLength = 80;
    const cap = document.createElement('input');
    cap.type = 'number';
    cap.min = '0';
    cap.className = name.className;
    cap.placeholder = 'Teto do mês em centavos';
    const save = line('button', 'Salvar cliente');
    save.type = 'button';
    save.className = 'brand-btn';
    const list = document.createElement('div');
    box.append(name, cap, save, list);
    async function load() {
      const data = await quiet('/api/agency/clients');
      list.replaceChildren();
      for (const client of data.clients || [])
        list.append(
          line(
            'p',
            client.name +
              ' · gasto no mês R$ ' +
              (client.spent_cents / 100).toFixed(2).replace('.', ',') +
              (client.spend_cap_cents
                ? ' · teto R$ ' + (client.spend_cap_cents / 100).toFixed(2).replace('.', ',')
                : '')
          )
        );
      const select = document.getElementById('agency-client-select');
      if (select) {
        const current = select.value;
        select.replaceChildren(new Option('Sem cliente da agência', ''));
        for (const client of data.clients || [])
          select.append(new Option(client.name, String(client.id)));
        select.value = current;
      }
    }
    save.onclick = async () => {
      try {
        await apiCall('/api/agency/clients', 'POST', {
          name: name.value,
          spend_cap_cents: Number(cap.value || 0),
        });
        name.value = '';
        cap.value = '';
        await load();
      } catch {}
    };
    try {
      await load();
    } catch {}
  }

  function clientField() {
    const link = document.getElementById('order-link-input');
    if (!link || document.getElementById('agency-client-select')) return;
    const select = document.createElement('select');
    select.id = 'agency-client-select';
    select.className = link.className;
    select.append(new Option('Sem cliente da agência', ''));
    link.before(select);
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-follow]');
    if (!button) return;
    event.preventDefault();
    const id = button.dataset.id;
    if (button.dataset.follow === 'ficha') openFicha(id);
    if (button.dataset.follow === 'cancel') cancelOrder(id);
    if (button.dataset.follow === 'reorder') reorder(id);
  });

  const openView = navigateTo;
  navigateTo = function (viewName) {
    const result = openView.apply(this, arguments);
    if (viewName === 'new-order') showFavorites();
    if (viewName === 'agency') showClients();
    if (viewName === 'orders') paintNotices();
    return result;
  };

  massTools();
  clientField();
  setInterval(() => {
    if (document.hidden || !state.token) return;
    if (state.currentView === 'orders') {
      loadUserOrders(false);
      paintNotices();
    }
    if (state.currentView === 'dashboard') window.loadPanelDashboard?.();
  }, 8000);
})();
