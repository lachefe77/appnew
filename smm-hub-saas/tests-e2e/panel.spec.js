const { test, expect } = require('@playwright/test');
let token;
test.beforeAll(async ({ request }) => {
  const r = await request.post('/api/auth/login', {
    data: { email: 'admin@e2e.invalid', password: 'E2E-password-12345' },
  });
  expect(r.ok()).toBeTruthy();
  token = (await r.json()).token;
});
test('Entrada pública mostra vitrine e painel exige login', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('#main-sidebar')).toHaveCount(0);
  await page.goto('/painel.html');
  await page.waitForURL(/login.html/);
});
test('Painel navega por cliques reais em todas as abas', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((t) => {
    localStorage.setItem('smm_token', t);
    window.cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      window.cspViolations.push(e.effectiveDirective),
    );
  }, token);
  await page.goto('/');
  await page.waitForURL(/painel.html/);
  await expect(page.locator('#metric-my-orders')).not.toHaveText('—');
  const views = await page
    .locator('.nav-link[data-view]')
    .evaluateAll((nodes) => nodes.map((n) => n.dataset.view));
  for (const view of views) {
    await page.locator('.nav-link[data-view="' + view + '"]').click();
    await expect(page.locator('#view-' + view)).toBeVisible();
    await expect(page.locator('.view-panel:visible')).toHaveCount(1);
  }
  const duplicates = await page
    .locator('[id]')
    .evaluateAll((nodes) =>
      nodes.map((n) => n.id).filter((id, i, all) => all.indexOf(id) !== i),
    );
  expect(duplicates).toEqual([]);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
});
test('Menu móvel abre e seleciona novo pedido', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript((t) => localStorage.setItem('smm_token', t), token);
  await page.goto('/painel.html');
  await expect(page.locator('#metric-my-orders')).not.toHaveText('—');
  await page.locator('#btn-toggle-sidebar').click();
  await expect(page.locator('#btn-toggle-sidebar')).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await page.locator('[data-view="new-order"]').click();
  await expect(page.locator('#view-new-order')).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test('Compra de combo cobra uma vez e cria todos os itens pelo painel', async ({
  page,
  request,
}) => {
  const headers = { Authorization: 'Bearer ' + token };
  const data = await (await request.get('/api/services')).json();
  const service = data.services[0];
  const price = Math.max(
    5000,
    Math.round((service.price_per_k_cents * service.min_quantity) / 1000) * 3,
  );
  const created = await request.post('/api/admin/combos', {
    headers,
    data: {
      name: 'Combo navegador',
      description: 'Validação integrada',
      price_cents: price,
      items: [
        { service_id: service.id, quantity: service.min_quantity },
        { service_id: service.id, quantity: service.min_quantity },
      ],
    },
  });
  expect(created.status()).toBe(201);
  await page.addInitScript((t) => localStorage.setItem('smm_token', t), token);
  await page.goto('/painel.html#combos');
  await page.locator('#all-combos .combo-card button').first().click();
  await page.locator('dialog input').nth(0).fill('https://example.com/combo-a');
  await page.locator('dialog input').nth(1).fill('https://example.com/combo-b');
  const response = page.waitForResponse(
    (r) => r.url().includes('/purchase') && r.request().method() === 'POST',
  );
  await page.locator('dialog button[type=submit]').click();
  const purchase = await response;
  expect(purchase.status()).toBe(201);
  const result = await purchase.json();
  expect(result.order_ids).toHaveLength(2);
  await expect(page.locator('#view-orders')).toBeVisible();
  const repeat = await request.post(new URL(purchase.url()).pathname, {
    headers,
    data: purchase.request().postDataJSON(),
  });
  expect(repeat.status()).toBe(200);
  expect((await repeat.json()).order_ids).toEqual(result.order_ids);
});

test('Formulários de pedido, lote e assinatura funcionam por clique',async({page,request})=>{
await page.addInitScript(t=>localStorage.setItem('smm_token',t),token);await page.goto('/painel.html');await expect(page.locator('#metric-my-orders')).not.toHaveText('—');
await page.locator('[data-view="new-order"]').click();await page.locator('[data-platform="instagram"]').click();await page.locator('#order-link-input').fill('https://instagram.com/e2e_panel');await expect(page.locator('#order-total-preview')).toContainText('R$');const order=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/orders'&&r.request().method()==='POST');await page.locator('#btn-submit-order').click();expect((await order).status()).toBe(201);await expect(page.locator('#view-orders')).toBeVisible();
const services=await(await request.get('/api/services')).json();const service=services.services[0];await page.locator('[data-view="mass-order"]').click();await page.locator('#mass-order-textarea').fill(service.id+' | '+service.min_quantity+' | https://example.com/lote-a\n'+service.id+' | '+service.min_quantity+' | https://example.com/lote-b');const batch=page.waitForResponse(r=>r.url().includes('/orders/mass')&&r.request().method()==='POST');await page.locator('#btn-submit-mass').click();expect((await batch).status()).toBe(201);await expect(page.locator('#view-orders')).toBeVisible();
await page.locator('[data-view="subscriptions"]').click();await page.locator('#sub-service-select').selectOption(String(service.id));await page.locator('#sub-username').fill('e2e_panel');await page.locator('#sub-min-qty').fill(String(Math.max(50,service.min_quantity)));await page.locator('#sub-max-qty').fill(String(Math.max(50,service.min_quantity)));const subscription=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/subscriptions'&&r.request().method()==='POST');await page.locator('#view-subscriptions button[type="submit"]').click();expect((await subscription).status()).toBe(201);await expect(page.locator('#subscriptions-table-body')).toContainText('e2e_panel');
});

test('Admin publica, edita e pausa combo pelo formulário',async({page})=>{
await page.addInitScript(t=>localStorage.setItem('smm_token',t),token);await page.goto('/admin.html');await page.locator('[data-pane="combos"]').click();await page.getByRole('button',{name:'Criar combo',exact:true}).click();await page.locator('dialog input').nth(0).fill('Combo gestão navegador');await page.locator('dialog textarea').fill('Pacote do painel');await page.locator('dialog input[type=number]').first().fill('100');const created=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/admin/combos'&&r.request().method()==='POST');await page.getByRole('button',{name:'Publicar combo',exact:true}).click();expect((await created).status()).toBe(201);await expect(page.locator('dialog')).toHaveCount(0);const card=page.locator('#pane-combos article').filter({hasText:'Combo gestão navegador'});await expect(card).toBeVisible();await card.getByRole('button',{name:'Editar',exact:true}).click();await page.locator('dialog input').nth(0).fill('Combo gestão atualizado');await page.getByRole('button',{name:'Salvar alterações',exact:true}).click();await expect(page.locator('dialog')).toHaveCount(0);const updated=page.locator('#pane-combos article').filter({hasText:'Combo gestão atualizado'});await updated.getByRole('button',{name:'Pausar',exact:true}).click();await expect(updated).toContainText('Pausado');
});

test('Pedido parcelado salva lotes e mantém CSP sem eventos embutidos',async({page,request})=>{
await page.addInitScript(t=>localStorage.setItem('smm_token',t),token);const response=await page.goto('/painel.html');expect(response.headers()['content-security-policy']).toContain("script-src-attr 'none'");await expect(page.locator('#metric-my-orders')).not.toHaveText('—');await page.locator('[data-view="new-order"]').click();const min=await page.evaluate(()=>state.selectedService.min_quantity);await page.locator('#order-dripfeed-toggle').check();await page.locator('#order-drip-runs').fill('3');await page.locator('#order-drip-interval').fill('10');await page.locator('#order-qty-input').fill(String(min*3+1));await page.locator('#order-link-input').fill('https://example.com/parcelado');const result=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/orders'&&r.request().method()==='POST');await page.locator('#btn-submit-order').click();const orderResponse=await result;expect(orderResponse.status()).toBe(201);const data=await orderResponse.json();const detail=await request.get('/api/orders/'+data.order.id,{headers:{Authorization:'Bearer '+token}});const order=(await detail.json()).order;expect(order.batches).toHaveLength(3);expect(order.batches.reduce((n,b)=>n+b.quantity,0)).toBe(min*3+1);expect(order.batches[0].remote_id).toBeUndefined();await page.evaluate(()=>{const img=document.createElement('img');img.setAttribute('onerror','window.injectedPanelScript=1');img.src='/missing-csp-test.png';document.body.append(img);});await page.waitForLoadState('networkidle');expect(await page.evaluate(()=>window.injectedPanelScript)).toBeUndefined();
});
