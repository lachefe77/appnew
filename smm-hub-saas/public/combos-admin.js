(() => {
  const pane = document.getElementById('pane-combos');
  if (!pane) return;
  const el = (tag, text) => {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    return node;
  };
  loaders.combos = async () => {
    pane.replaceChildren();
    const heading = el('h2', 'Combos e promoções'),
      newButton = el('button', 'Criar combo'),
      feedback = el('p'),
      list = el('div');
    newButton.className = 'btn btn-primary';
    feedback.setAttribute('role', 'status');
    pane.append(heading, newButton, feedback, list);
    try {
      const [result, catalog] = await Promise.all([
        api('/api/admin/combos'),
        api('/api/admin/services'),
      ]);
      const services = catalog.services.filter(
        (service) => service.status === 'active' && service.type!=='custom_comments',
      );
      newButton.onclick = () => edit(null, services);
      if (!result.combos.length)
        list.append(
          el(
            'p',
            'Nenhum combo criado. Publique um pacote para exibi-lo no Geral do painel.',
          ),
        );
      for (const combo of result.combos) {
        const card = el('article');
        card.className = 'card';
        card.style.marginTop = '16px';
        const title = el('h3', combo.name),
          description = el(
            'p',
            (combo.is_active ? 'Ativo' : 'Pausado') +
              ' · R$ ' +
              (combo.price_cents / 100).toFixed(2).replace('.', ',') +
              ' · ' +
              combo.items.length +
              ' itens',
          ),
          change = el('button', 'Editar'),
          toggle = el('button', combo.is_active ? 'Pausar' : 'Publicar'),
          share = el('button', 'Copiar link');
        for (const button of [change, toggle, share]) {
          button.className = 'btn btn-ghost';
          button.style.marginRight = '8px';
        }
        change.onclick = () => edit(combo, services);
        toggle.onclick = async () => {
          toggle.disabled = true;
          try {
            await api('/api/admin/combos/' + combo.id + '/status', {
              method: 'POST',
              body: JSON.stringify({ is_active: combo.is_active ? 0 : 1 }),
            });
            await loaders.combos();
          } catch (error) {
            feedback.textContent = error.message;
            toggle.disabled = false;
          }
        };
        share.onclick = async () => {
          try {
            await navigator.clipboard.writeText(
              location.origin + '/painel.html?combo=' + combo.id + '#combos',
            );
            feedback.textContent = 'Link do combo copiado.';
          } catch {
            feedback.textContent =
              location.origin + '/painel.html?combo=' + combo.id + '#combos';
          }
        };
        card.append(title, description, change, toggle, share);
        list.append(card);
      }
    } catch (error) {
      feedback.textContent = error.message;
    }
  };
  function edit(combo, services) {
    const dialog = el('dialog'),
      form = el('form'),
      name = el('input'),
      description = el('textarea'),
      price = el('input'),
      items = el('div'),
      message = el('p');
    dialog.style.cssText =
      'width:min(660px,95vw);padding:26px;border:1px solid #333;border-radius:12px;background:#141414;color:white';
    name.className = description.className = price.className = 'input';
    name.required = true;
    name.maxLength = 120;
    description.maxLength = 2000;
    price.type = 'number';
    price.min = '.5';
    price.step = '.01';
    price.required = true;
    name.value = combo?.name || '';
    description.value = combo?.description || '';
    price.value = combo ? (combo.price_cents / 100).toFixed(2) : '';
    form.append(el('h2', combo ? 'Editar combo' : 'Criar combo'));
    for (const [title, input] of [
      ['Nome', name],
      ['Descrição', description],
      ['Preço total (R$)', price],
    ]) {
      const label = el('label', title);
      label.style.cssText = 'display:grid;gap:6px;margin:14px 0';
      label.append(input);
      form.append(label);
    }
    form.append(
      el(
        'p',
        'Cada item deve informar o serviço e a quantidade. O sistema verifica preço mínimo, limites e margem.',
      ),
      items,
    );
    const rows = [];
    function add(item) {
      if (rows.filter((row) => row.node.isConnected).length >= 20) return;
      const node = el('div'),
        select = el('select'),
        quantity = el('input'),
        remove = el('button', 'Remover');
      node.style.cssText =
        'display:grid;grid-template-columns:minmax(0,1fr) 100px auto;gap:8px;margin:10px 0';
      select.className = quantity.className = 'input';
      quantity.type = 'number';
      quantity.required = true;
      quantity.step = '1';
      select.setAttribute('aria-label', 'Serviço do combo');
      quantity.setAttribute('aria-label', 'Quantidade do item');
      for (const service of services) {
        const option = el('option', service.name);
        option.value = service.id;
        select.append(option);
      }
      if (item) select.value = item.service_id;
      function bounds() {
        const service = services.find(
          (value) => value.id === Number(select.value),
        );
        if (service) {
          quantity.min = service.min_quantity;
          quantity.max = service.max_quantity;
          if (!quantity.value) quantity.value = service.min_quantity;
        }
      }
      select.onchange = () => {
        quantity.value = '';
        bounds();
      };
      quantity.value = item?.quantity || '';
      bounds();
      remove.type = 'button';
      remove.onclick = () => node.remove();
      node.append(select, quantity, remove);
      items.append(node);
      rows.push({ node, select, quantity });
    }
    const more = el('button', 'Adicionar item');
    more.type = 'button';
    more.className = 'btn btn-ghost';
    more.onclick = () => add();
    const cancel = el('button', 'Cancelar');
    cancel.type = 'button';
    cancel.onclick = () => dialog.close();
    const submit = el('button', combo ? 'Salvar alterações' : 'Publicar combo');
    submit.className = 'btn btn-primary';
    submit.type = 'submit';
    form.append(more, message, cancel, submit);
    dialog.append(form);
    document.body.append(dialog);
    dialog.onclose = () => dialog.remove();
    for (const item of combo?.items || [null]) add(item);
    form.onsubmit = async (event) => {
      event.preventDefault();
      submit.disabled = true;
      try {
        const value = {
          name: name.value,
          description: description.value,
          price_cents: Math.round(Number(price.value) * 100),
          items: rows
            .filter((row) => row.node.isConnected)
            .map((row) => ({
              service_id: Number(row.select.value),
              quantity: Number(row.quantity.value),
            })),
        };
        await api('/api/admin/combos' + (combo ? '/' + combo.id : ''), {
          method: combo ? 'PUT' : 'POST',
          body: JSON.stringify(value),
        });
        dialog.close();
        await loaders.combos();
      } catch (error) {
        message.textContent = error.message;
      } finally {
        submit.disabled = false;
      }
    };
    dialog.showModal();
  }
})();
