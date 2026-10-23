const { test, expect } = require('@playwright/test');
test('Compra autenticada usa saldo e detalhe não expõe custo nem provedor', async ({
  request,
}) => {
  const login = await request.post('/api/auth/login', {
    data: { email: 'admin@e2e.invalid', password: 'E2E-password-12345' },
  });
  expect(login.status()).toBe(200);
  const { token } = await login.json();
  const headers = { Authorization: 'Bearer ' + token };
  const services = await request.get('/api/services');
  const service = (await services.json()).services[0];
  const created = await request.post('/api/orders', {
    headers,
    data: {
      service_id: service.id,
      quantity: service.min_quantity,
      link: 'https://example.com/e2e-purchase',
    },
  });
  expect(created.status()).toBe(201);
  const { order } = await created.json();
  const detail = await request.get('/api/orders/' + order.id, { headers });
  expect(detail.status()).toBe(200);
  const data = await detail.json();
  expect(data.order.quantity).toBe(service.min_quantity);
  expect(data.order.cost_cents).toBeUndefined();
  expect(data.order.provider_id).toBeUndefined();
  const refused = await request.get(
    '/api/orders/' + order.id + '?token=' + token
  );
  expect(refused.status()).toBe(401);
});

test('Perfil apresenta sessões e confirmação de e-mail sem erros de JavaScript', async ({
  page,
  request,
}) => {
  const response = await request.post('/api/auth/login', {
    data: { email: 'admin@e2e.invalid', password: 'E2E-password-12345' },
  });
  const { token } = await response.json();
  await page.addInitScript(
    (value) => localStorage.setItem('smm_token', value),
    token
  );
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/profile.html');
  await page.locator('[data-tab="security"]').click();
  await expect(
    page.getByRole('heading', { name: 'Dispositivos conectados' })
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Confirmação do e-mail' })
  ).toBeVisible();
  expect(errors).toEqual([]);
});
