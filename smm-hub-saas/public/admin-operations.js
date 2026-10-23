(() => {
  for (const name of [
    'scheduled',
    'giveaways',
    'challenges',
    'combos',
    'invoices',
  ]) {
    const pane = document.getElementById('pane-' + name);
    if (!pane) continue;
    const output = document.createElement('div');
    output.className = 'card';
    pane.append(output);
    loaders[name] = async () => {
      output.textContent = 'Carregando…';
      try {
        const r = await api('/api/admin/operations/' + name);
        output.replaceChildren();
        if (!r.rows.length) {
          output.textContent = 'Nenhum registro.';
          return;
        }
        const table = document.createElement('table'),
          head = document.createElement('thead'),
          body = document.createElement('tbody');
        const keys = Object.keys(r.rows[0]).filter((k) => !k.endsWith('_json'));
        const header = document.createElement('tr');
        for (const key of keys) {
          const th = document.createElement('th');
          th.textContent = key;
          header.append(th);
        }
        head.append(header);
        for (const row of r.rows) {
          const tr = document.createElement('tr');
          for (const key of keys) {
            const td = document.createElement('td');
            td.textContent = String(row[key] ?? '');
            tr.append(td);
          }
          body.append(tr);
        }
        table.append(head, body);
        output.append(table);
      } catch {
        output.textContent = 'Não foi possível carregar os registros.';
      }
    };
  }
  const original = loadServices;
  loadServices = async () => {
    await original();
    const r = await api('/api/admin/services');
    const container = document.getElementById('s-tbl');
    const tools = document.createElement('div');
    for (const service of r.services) {
      const button = document.createElement('button');
      button.className = 'btn btn-ghost';
      button.textContent = 'Editar #' + service.id;
      button.onclick = () => {
        const dialog = document.createElement('dialog'),
          form = document.createElement('form'),
          controls = {};
        form.style.minWidth = '320px';
        for (const key of [
          'name',
          'cost_per_k_cents',
          'price_per_k_cents',
          'min_quantity',
          'max_quantity',
          'backup_provider_id',
          'backup_service_id',
          'status',
          'description',
        ]) {
          const label = document.createElement('label');
          label.style.display = 'block';
          label.textContent = key;
          const input = document.createElement('input');
          input.className = 'input';
          input.value = service[key] ?? '';
          controls[key] = input;
          label.append(input);
          form.append(label);
        }
        const save = document.createElement('button');
        save.textContent = 'Salvar serviço';
        save.type = 'submit';
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.textContent = 'Cancelar';
        cancel.onclick = () => dialog.close();
        const message = document.createElement('p');
        form.append(save, cancel, message);
        dialog.append(form);
        document.body.append(dialog);
        dialog.onclose = () => dialog.remove();
        form.onsubmit = async (e) => {
          e.preventDefault();
          save.disabled = true;
          try {
            const payload = { ...service };
            for (const [k, input] of Object.entries(controls))
              payload[k] = input.value;
            const result = await api('/api/admin/services/' + service.id, {
              method: 'PUT',
              body: JSON.stringify(payload),
            });
            if (result.error) message.textContent = result.error;
            else {
              dialog.close();
              await loadServices();
            }
          } catch {
            message.textContent = 'Não foi possível salvar.';
          } finally {
            save.disabled = false;
          }
        };
        dialog.showModal();
      };
      tools.append(button);
    }
    container.prepend(tools);
  };
  loaders.services = loadServices;
})();
