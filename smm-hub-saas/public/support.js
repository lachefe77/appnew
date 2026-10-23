(() => {
  const token = localStorage.getItem('smm_token');
  if (!token) {
    location.href = '/login.html';
    return;
  }
  const status = document.getElementById('status'),
    list = document.getElementById('tickets'),
    conversation = document.getElementById('conversation');
  async function api(path, body) {
    const r = await fetch('/api/support' + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Falha no atendimento.');
    return data;
  }
  async function load() {
    try {
      const r = await api('/tickets');
      list.replaceChildren();
      for (const ticket of r.tickets) {
        const b = document.createElement('button');
        b.className = 'brand-btn';
        b.style.display = 'block';
        b.style.marginBottom = '8px';
        b.textContent =
          '#' + ticket.id + ' · ' + ticket.subject + ' · ' + ticket.status;
        b.onclick = () => open(ticket.id);
        list.append(b);
      }
      if (!r.tickets.length) list.textContent = 'Nenhum chamado.';
    } catch (e) {
      status.textContent = e.message;
    }
  }
  async function open(id) {
    try {
      const r = await api('/tickets/' + id);
      conversation.replaceChildren();
      const title = document.createElement('h2');
      title.textContent = r.ticket.subject;
      conversation.append(title);
      for (const m of r.messages) {
        const card = document.createElement('article'),
          text = document.createElement('p');
        text.textContent = m.sender_name + ': ' + m.message;
        card.append(text);
        for (const a of m.attachments) {
          const button = document.createElement('button');
          button.textContent = 'Baixar ' + a.filename;
          button.onclick = async () => {
            const response = await fetch('/api/tickets/attachment/' + a.id, {
              headers: { Authorization: 'Bearer ' + token },
            });
            if (!response.ok) {
              status.textContent = 'Download indisponível.';
              return;
            }
            const url = URL.createObjectURL(await response.blob()),
              link = document.createElement('a');
            link.href = url;
            link.download = a.filename;
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          };
          card.append(button);
        }
        conversation.append(card);
      }
      const form = document.createElement('form'),
        input = document.createElement('textarea'),
        label = document.createElement('label'),
        close = document.createElement('input'),
        send = document.createElement('button');
      input.required = true;
      input.maxLength = 10000;
      input.className = 'brand-input';
      input.setAttribute('aria-label', 'Resposta');
      close.type = 'checkbox';
      label.textContent = 'Encerrar chamado';
      label.append(close);
      send.textContent = 'Enviar resposta';
      send.type = 'submit';
      send.className = 'brand-btn';
      const attachmentsInput = document.createElement('input');
      attachmentsInput.type = 'file';
      attachmentsInput.multiple = true;
      attachmentsInput.accept =
        'image/png,image/jpeg,image/gif,image/webp,application/pdf';
      attachmentsInput.setAttribute('aria-label', 'Até três anexos de 2 MB');
      form.append(input, attachmentsInput, label, send);
      form.onsubmit = async (e) => {
        e.preventDefault();
        send.disabled = true;
        try {
          const files = Array.from(attachmentsInput.files);
          if (
            files.length > 3 ||
            files.some((file) => file.size > 2 * 1024 * 1024)
          )
            throw new Error('Use até três anexos de 2 MB cada.');
          const attachments = await Promise.all(
            files.map(
              (file) =>
                new Promise((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onerror = () =>
                    reject(new Error('Não foi possível ler o anexo.'));
                  reader.onload = () =>
                    resolve({
                      filename: file.name,
                      mime_type: file.type,
                      data_base64: String(reader.result).split(',')[1],
                    });
                  reader.readAsDataURL(file);
                })
            )
          );
          await api('/tickets/' + id + '/reply', {
            message: input.value,
            close: close.checked,
            attachments,
          });
          await open(id);
          await load();
        } catch (e) {
          status.textContent = e.message;
          send.disabled = false;
        }
      };
      conversation.append(form);
    } catch (e) {
      status.textContent = e.message;
    }
  }
  load();
})();
