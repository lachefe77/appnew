(() => {
  const root = document.getElementById('mesa-root');
  if (!root || typeof loaders === 'undefined') return;

  const previousOrders = loadOrders;
  loadOrders = async function () {
    const q = document.getElementById('o-search')?.value.trim();
    if (!q) return previousOrders();
    const data = await api('/api/admin/orders/lookup?q=' + encodeURIComponent(q));
    const host = document.getElementById('o-tbl');
    host.textContent = '';
    host.append(grid(data.orders || []));
  };
  loaders.orders = loadOrders;

  function grid(list) {
    const table = document.createElement('table');
    if (!list.length) {
      table.textContent = 'Nenhum registro.';
      return table;
    }
    const keys = Object.keys(list[0]).filter((key) => typeof list[0][key] !== 'object');
    const head = document.createElement('tr');
    for (const key of keys) {
      const cell = document.createElement('th');
      cell.textContent = key;
      head.append(cell);
    }
    table.append(head);
    for (const row of list) {
      const line = document.createElement('tr');
      for (const key of keys) {
        const cell = document.createElement('td');
        cell.textContent = row[key] ?? '';
        line.append(cell);
      }
      table.append(line);
    }
    return table;
  }

  async function download(path, filename) {
    const response = await fetch(path, {
      headers: { Authorization: 'Bearer ' + token },
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Download recusado.');
    }
    const blob = await response.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
  }

  function field(label, value, type) {
    const wrap = document.createElement('label');
    wrap.style.display = 'block';
    wrap.style.margin = '8px 0';
    wrap.append(document.createTextNode(label));
    const input = document.createElement(type === 'area' ? 'textarea' : 'input');
    input.className = 'input';
    if (type && type !== 'area') input.type = type;
    input.value = value || '';
    wrap.append(input);
    return { wrap, input };
  }

  function button(label, action) {
    const node = document.createElement('button');
    node.className = 'btn btn-primary';
    node.type = 'button';
    node.style.margin = '8px 8px 8px 0';
    node.textContent = label;
    node.onclick = async () => {
      node.disabled = true;
      try {
        await action();
      } catch (error) {
        message(error.message || 'Não foi possível concluir.');
      } finally {
        node.disabled = false;
      }
    };
    return node;
  }

  let output;
  function message(text) {
    output.textContent = text;
    output.scrollIntoView({ block: 'start' });
  }
  function show(data) {
    output.textContent = '';
    if (Array.isArray(data)) output.append(grid(data));
    else {
      const pre = document.createElement('pre');
      pre.textContent = JSON.stringify(data, null, 2);
      output.append(pre);
    }
    output.scrollIntoView({ block: 'start' });
  }

  loaders.mesa = async function () {
    root.textContent = '';
    const intro = document.createElement('p');
    intro.textContent =
      'Cobrança e VPS ficam prontas para você configurar aqui. Nada nesta mesa cobra o cliente nem altera a vitrine.';
    output = document.createElement('div');
    output.style.marginTop = '12px';
    const tools = document.createElement('div');

    const groups = [
      ['Caixa da manhã', () => api('/api/admin/ops/inbox')],
      ['Status das integrações', () => api('/api/admin/ops/readiness')],
      ['Fila de webhooks', async () => show((await api('/api/admin/ops/webhooks')).webhooks)],
      ['Pix registrados', async () => show((await api('/api/admin/ops/pix')).invoices)],
      ['Cripto registrada', async () => show((await api('/api/admin/ops/crypto')).invoices)],
      ['Preço abaixo do custo', async () => show((await api('/api/admin/services/below-cost')).services)],
      ['Fila de reposição', async () => show((await api('/api/admin/refills')).refills)],
      ['Saúde dos fornecedores', () => api('/api/admin/providers/health')],
      ['Fechamento do dia', () => api('/api/admin/finance/day')],
      ['Lucro contra o custo registrado', () => api('/api/admin/finance/profit')],
      ['Uso dos cupons', async () => show((await api('/api/admin/coupons/usage')).coupons)],
      ['Papéis', async () => show((await api('/api/admin/roles')).roles)],
      ['Log das assinaturas', () => api('/api/admin/subscriptions/log')],
      ['Sessões da equipe', async () => show((await api('/api/admin/staff/sessions')).sessions)],
      ['Linha do tempo dos subpainéis', () => api('/api/admin/children/timeline')],
      ['Checklist da VPS', () => api('/api/admin/checklist')],
      ['Respostas prontas', async () => show((await api('/api/admin/canned-replies')).replies)],
    ];
    for (const [label, run] of groups)
      tools.append(
        button(label, async () => {
          const data = await run();
          if (data) show(data);
        })
      );

    tools.append(
      button('Exportar pedidos', () => download('/api/admin/orders/export.csv', 'pedidos.csv')),
      button('Erros do pedido em massa', () => download('/api/admin/mass-errors.csv', 'erros-lote.csv')),
      button('Comissões do mês', async () => {
        const month = new Date().toISOString().slice(0, 7);
        await download('/api/admin/affiliates/month.csv?month=' + month, 'comissoes-' + month + '.csv');
      })
    );

    const forms = document.createElement('div');
    forms.style.marginTop = '16px';

    function form(title, nodes, onSubmit) {
      const box = document.createElement('form');
      box.className = 'card';
      box.style.marginTop = '12px';
      const heading = document.createElement('h3');
      heading.textContent = title;
      box.append(heading);
      for (const node of nodes) box.append(node.wrap || node);
      const save = document.createElement('button');
      save.className = 'btn btn-primary';
      save.type = 'submit';
      save.textContent = 'Aplicar';
      box.append(save);
      box.onsubmit = async (event) => {
        event.preventDefault();
        save.disabled = true;
        try {
          show(await onSubmit());
        } catch (error) {
          message(error.message || 'Não foi possível concluir.');
        } finally {
          save.disabled = false;
        }
      };
      return box;
    }

    const orderId = field('Pedido', '', 'number');
    const note = field('Nota interna', '', 'area');
    forms.append(
      form('Ficha do pedido', [orderId, note], async () => {
        if (note.input.value.trim())
          await api('/api/admin/orders/' + orderId.input.value + '/notes', {
            method: 'POST',
            body: JSON.stringify({ note: note.input.value }),
          });
        return api('/api/admin/orders/' + orderId.input.value + '/desk');
      })
    );

    const refundOrder = field('Pedido do estorno', '', 'number');
    const refundCents = field('Centavos', '', 'number');
    forms.append(
      form('Estorno parcial', [refundOrder, refundCents], () =>
        api('/api/admin/orders/' + refundOrder.input.value + '/partial-refund', {
          method: 'POST',
          body: JSON.stringify({ amount_cents: Number(refundCents.input.value) }),
        })
      )
    );

    const platformId = field('Id da plataforma', '', 'number');
    const paused = field('1 pausa, 0 libera', '1');
    forms.append(
      form('Pausar plataforma', [platformId, paused], () =>
        api('/api/admin/platforms/' + platformId.input.value + '/pause', {
          method: 'POST',
          body: JSON.stringify({ paused: paused.input.value === '1' }),
        })
      )
    );

    const reassignPlatform = field('Plataforma', 'Instagram');
    const reassignProvider = field('Id do fornecedor', '', 'number');
    forms.append(
      form('Trocar fornecedor da plataforma', [reassignPlatform, reassignProvider], () =>
        api('/api/admin/services/reassign', {
          method: 'POST',
          body: JSON.stringify({
            platform: reassignPlatform.input.value,
            provider_id: Number(reassignProvider.input.value),
          }),
        })
      )
    );

    const previewProvider = field('Id do fornecedor para prévia', '', 'number');
    forms.append(
      form('Prévia da sincronização', [previewProvider], () =>
        api('/api/admin/providers/' + previewProvider.input.value + '/sync-preview')
      )
    );

    forms.append(
      form('Desfazer a última margem', [], () =>
        api('/api/admin/services/markup-undo', { method: 'POST' })
      )
    );

    const ledgerUser = field('Id do cliente', '', 'number');
    forms.append(
      form('Extrato do cliente', [ledgerUser], async () => {
        await download(
          '/api/admin/users/' + ledgerUser.input.value + '/ledger.csv',
          'extrato.csv'
        );
        return { message: 'Extrato baixado.' };
      })
    );

    const scheduleId = field('Agendamento', '', 'number');
    const scheduleLink = field('Novo link', '');
    const scheduleAt = field('Nova data ISO', '');
    forms.append(
      form('Editar agendamento pendente', [scheduleId, scheduleLink, scheduleAt], () =>
        api('/api/admin/scheduled/' + scheduleId.input.value, {
          method: 'PUT',
          body: JSON.stringify({
            link: scheduleLink.input.value,
            run_at: scheduleAt.input.value,
          }),
        })
      )
    );

    const giveawayId = field('Sorteio', '', 'number');
    forms.append(
      form('Inscritos do sorteio', [giveawayId], () =>
        api('/api/admin/giveaways/' + giveawayId.input.value + '/entries')
      )
    );
    const challengeId = field('Desafio', '', 'number');
    forms.append(
      form('Progresso do desafio', [challengeId], () =>
        api('/api/admin/challenges/' + challengeId.input.value + '/progress')
      )
    );

    const ticketId = field('Chamado', '', 'number');
    const assignee = field('Id de quem assume', '', 'number');
    forms.append(
      form('Dono do chamado', [ticketId, assignee], () =>
        api('/api/admin/tickets/' + ticketId.input.value + '/assignee', {
          method: 'POST',
          body: JSON.stringify({ assignee_id: Number(assignee.input.value) }),
        })
      )
    );

    const cannedTitle = field('Título', '');
    const cannedBody = field('Texto', '', 'area');
    forms.append(
      form('Nova resposta pronta', [cannedTitle, cannedBody], () =>
        api('/api/admin/canned-replies', {
          method: 'POST',
          body: JSON.stringify({
            title: cannedTitle.input.value,
            body: cannedBody.input.value,
          }),
        })
      )
    );

    const auditAdmin = field('Id do admin', '');
    const auditAction = field('Ação', '');
    const auditFrom = field('De', '', 'date');
    const auditTo = field('Até', '', 'date');
    forms.append(
      form('Filtro do audit log', [auditAdmin, auditAction, auditFrom, auditTo], async () => {
        const params = new URLSearchParams();
        if (auditAdmin.input.value) params.set('admin_id', auditAdmin.input.value);
        if (auditAction.input.value) params.set('action', auditAction.input.value);
        if (auditFrom.input.value) params.set('from', auditFrom.input.value);
        if (auditTo.input.value) params.set('to', auditTo.input.value);
        return api('/api/admin/audit/search?' + params.toString());
      })
    );

    const sample = field('Link de exemplo', 'https://instagram.com/exemplo');
    const pattern = field('Padrão ou /expressão/i', 'instagram.com');
    forms.append(
      form('Testar bloqueio de link', [sample, pattern], () =>
        api('/api/admin/blocked-links/test', {
          method: 'POST',
          body: JSON.stringify({ sample: sample.input.value, pattern: pattern.input.value }),
        })
      )
    );

    const freeze = field('1 trava compra nova, 0 libera', '0');
    forms.append(
      form('Travar compra nova', [freeze], () =>
        api('/api/admin/ops/freeze', {
          method: 'POST',
          body: JSON.stringify({ freeze_mode: Number(freeze.input.value) }),
        })
      )
    );

    const hours = field('Horas da conta nova', '0');
    const cap = field('Teto em centavos', '0');
    const floor = field('Piso de saldo upstream', '0');
    const guard = field('Pedido duplicado: 1 liga, 0 desliga', '0');
    const maintenance = field('Manutenção: 1 liga, 0 desliga', '0');
    const training = field('Depósito de ensaio: 1 liga, 0 desliga', '0');
    const grace = field('Horas de carência da chave de API', '24');
    forms.append(
      form(
        'Chaves da mesa',
        [hours, cap, floor, guard, maintenance, training, grace],
        () =>
          api('/api/admin/ops/switches', {
            method: 'PUT',
            body: JSON.stringify({
              new_account_hours: Number(hours.input.value),
              new_account_spend_cap_cents: Number(cap.input.value),
              provider_balance_floor: Number(floor.input.value),
              duplicate_guard: Number(guard.input.value),
              maintenance_mode: Number(maintenance.input.value),
              training_deposits: Number(training.input.value),
              api_key_grace_hours: Number(grace.input.value),
            }),
          })
      )
    );

    const method = field('Método: boleto, credit_card, pix, bitcoin ou usdt', 'boleto');
    const provider = field('Provedor', '');
    const draftNote = field('Anotação', '', 'area');
    const secret = field('Chave, se já tiver', '', 'password');
    forms.append(
      form('Rascunho de cobrança', [method, provider, draftNote, secret], () =>
        api('/api/admin/ops/gateway-drafts/' + encodeURIComponent(method.input.value.trim()), {
          method: 'PUT',
          body: JSON.stringify({
            provider: provider.input.value,
            note: draftNote.input.value,
            secret: secret.input.value,
          }),
        })
      )
    );

    const trainUser = field('Id da conta @treino.invalid', '', 'number');
    const trainAmount = field('Centavos do ensaio', '1000');
    forms.append(
      form('Depósito de ensaio', [trainUser, trainAmount], () =>
        api('/api/admin/ops/training-deposit', {
          method: 'POST',
          body: JSON.stringify({
            user_id: Number(trainUser.input.value),
            amount_cents: Number(trainAmount.input.value),
          }),
        })
      )
    );

    const rotateUser = field('Cliente da chave de API', '', 'number');
    forms.append(
      form('Troca da chave com carência', [rotateUser], () =>
        api('/api/admin/users/' + rotateUser.input.value + '/rotate-api-key', {
          method: 'POST',
        })
      )
    );

    const recoveryUser = field('Membro com 2FA ativo', '', 'number');
    forms.append(
      form('Códigos de recuperação', [recoveryUser], () =>
        api('/api/admin/staff/' + recoveryUser.input.value + '/recovery-codes', {
          method: 'POST',
        })
      )
    );

    const backupLabel = field('Rótulo da cópia', 'semanal');
    const backupWhere = field('Destino anotado', 'disco externo da operação');
    forms.append(
      form('Destino de backup', [backupLabel, backupWhere], () =>
        api('/api/admin/backup-targets', {
          method: 'POST',
          body: JSON.stringify({
            label: backupLabel.input.value,
            location: backupWhere.input.value,
          }),
        })
      )
    );

    const checkItem = field('Item: dns, tls, firewall, offsite_copy, provider_reviewed, clock_ntp', 'dns');
    forms.append(
      form('Marcar item da VPS', [checkItem], () =>
        api('/api/admin/checklist', {
          method: 'POST',
          body: JSON.stringify({ item: checkItem.input.value.trim(), done: true }),
        })
      )
    );

    forms.append(
      button('Testar SMTP', async () => show(await api('/api/admin/ops/smtp-test', { method: 'POST' }))),
      button('Ver rascunhos de cobrança', async () => show(await api('/api/admin/ops/gateway-drafts'))),
      button('Ver destinos de backup', async () => show(await api('/api/admin/backup-targets')))
    );

    root.append(intro, output, tools, forms);
  };
})();
