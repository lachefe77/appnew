(() => {
  const canonicalHref = location.origin + '/';
  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical) canonical.href = canonicalHref;
  let ogUrl = document.querySelector('meta[property="og:url"]');
  if (!ogUrl) {
    ogUrl = document.createElement('meta');
    ogUrl.setAttribute('property', 'og:url');
    document.head.append(ogUrl);
  }
  ogUrl.setAttribute('content', canonicalHref);
  const text = (value) => String(value ?? '');
  const money = (cents) =>
    (Number(cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  function setText(id, value) {
    const node = document.getElementById(id);
    if (node) node.textContent = value;
  }

  fetch('/api/site/offer')
    .then((response) => response.json())
    .then((offer) => {
      const services = Number(offer.services || 0);
      const platforms = Number(offer.platforms || 0);
      setText('live-count', services ? services + ' serviços no catálogo' : 'Catálogo em preparação');
      setText('catalog-heading', platforms + ' plataformas. ' + services + ' serviços.');
      setText('s-delivered', Number(offer.delivered || 0).toLocaleString('pt-BR'));
      setText('s-clients', Number(offer.users || 0).toLocaleString('pt-BR'));
      setText('s-uptime', 'Não medido');
      setText('s-start', '—');
      setText('step-min', 'O mínimo atual é ' + Number(offer.min_deposit_brl || 5).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) + '.');
      const company = document.getElementById('company-line');
      if (company) {
        company.textContent = offer.company?.cnpj
          ? offer.company.name + ' · CNPJ ' + offer.company.cnpj
          : (offer.company?.name || 'SMM Hub') + ' · identificação empresarial ainda não configurada';
      }
      const social = document.getElementById('social-links');
      if (social) {
        social.textContent = '';
        const links = [
          ['Instagram', offer.social?.instagram],
          ['Telegram', offer.social?.telegram],
          ['WhatsApp', offer.social?.whatsapp ? 'https://wa.me/' + String(offer.social.whatsapp).replace(/\D/g, '') : ''],
        ].filter((item) => item[1]);
        if (!links.length) social.textContent = 'Redes sociais ainda não configuradas.';
        for (const [label, href] of links) {
          const link = document.createElement('a');
          link.href = href;
          link.textContent = label;
          link.rel = 'noreferrer';
          link.target = '_blank';
          social.append(link, ' ');
        }
      }
      const grid = document.getElementById('pay-grid');
      const empty = document.getElementById('pay-empty');
      if (grid) {
        grid.textContent = '';
        if (!offer.payments?.length) {
          if (empty) empty.hidden = false;
        } else if (empty) empty.hidden = true;
        for (const method of offer.payments || []) {
          const card = document.createElement('article');
          card.className = 'pay-card';
          const name = document.createElement('div');
          name.className = 'pc-name';
          name.textContent = method.label;
          const desc = document.createElement('div');
          desc.className = 'pc-desc';
          desc.textContent = method.description || '';
          const fee = document.createElement('div');
          fee.className = 'pc-fee';
          fee.textContent = 'Mínimo ' + money(method.min_amount_cents);
          card.append(name, desc, fee);
          grid.append(card);
        }
      }
      const warning = document.getElementById('provider-warning');
      if (warning) warning.hidden = Number(offer.real_providers || 0) > 0;
    })
    .catch(() => {});

  const catalog = document.getElementById('public-catalog');
  if (catalog) {
    const search = document.getElementById('catalog-search');
    let services = [];
    const draw = () => {
      const query = (search?.value || '').trim().toLowerCase();
      catalog.textContent = '';
      const list = services.filter((service) =>
        (service.name + ' ' + service.platform + ' ' + (service.category_name || '')).toLowerCase().includes(query)
      );
      if (!list.length) {
        catalog.textContent = 'Nenhum serviço encontrado.';
        return;
      }
      const table = document.createElement('table');
      table.innerHTML = '<thead><tr><th>Serviço</th><th>Mínimo</th><th>Preço / mil</th><th>Reposição</th></tr></thead>';
      const body = document.createElement('tbody');
      for (const service of list.slice(0, 80)) {
        const row = document.createElement('tr');
        const cells = [
          service.platform + ' · ' + service.name,
          String(service.min_quantity),
          money(service.price_per_k_cents),
          service.refill_available ? 'Sim' : 'Não',
        ];
        for (const value of cells) {
          const cell = document.createElement('td');
          cell.textContent = value;
          row.append(cell);
        }
        body.append(row);
      }
      table.append(body);
      catalog.append(table);
    };
    fetch('/api/services')
      .then((response) => response.json())
      .then((data) => {
        services = data.services || [];
        draw();
      })
      .catch(() => {
        catalog.textContent = 'Catálogo indisponível agora.';
      });
    if (search) search.addEventListener('input', draw);
  }

  fetch('/api/social-proof/recent')
    .then((response) => response.json())
    .then(({ events }) => {
      const ticker = document.getElementById('ticker');
      if (!ticker) return;
      if (!events?.length) {
        ticker.textContent = 'Ainda não há compras reais para mostrar.';
        return;
      }
      const items = events.concat(events);
      ticker.textContent = '';
      for (const event of items) {
        const item = document.createElement('div');
        item.className = 'ticker-item';
        item.textContent = text(event.user_name) + ' comprou ' + Number(event.quantity).toLocaleString('pt-BR') + ' ' + text(event.service_name);
        ticker.append(item);
      }
    })
    .catch(() => {});

  const proof = document.getElementById('proof-strip');
  if (proof) proof.style.display = 'none';

  if (!localStorage.getItem('lgpd_consent'))
    setTimeout(() => document.getElementById('lgpd')?.classList.add('show'), 1500);
  window.dismissLGPD = function () {
    localStorage.setItem('lgpd_consent', '1');
    document.getElementById('lgpd')?.classList.remove('show');
  };
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/service-worker.js').catch(() => {});
})();
