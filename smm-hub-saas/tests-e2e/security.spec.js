const { test, expect } = require('@playwright/test');
test.beforeEach(async ({ page }) => {
  await page.route('**/*', (route) => {
    const u = new URL(route.request().url());
    return ['127.0.0.1', 'localhost'].includes(u.hostname)
      ? route.continue()
      : route.abort();
  });
});
test('login mantém sessão após carregar painel', async ({ page }) => {
  const request=page.request;
  await page.goto('/login.html');
  await page.locator('#email').fill('admin@e2e.invalid');
  await page.locator('#password').fill('E2E-password-12345');
  await page.locator('#submit').click();
  await page.waitForURL(/\/painel\.html/);
  await expect
    .poll(() => page.evaluate(() => !!localStorage.getItem('smm_token')))
    .toBe(true);
  const token = await page.evaluate(() => localStorage.getItem('smm_token'));
  expect(token).toBe('browser-session');
  const cookie=(await page.context().cookies()).find(row=>row.name==='smm_session');
  expect(cookie.httpOnly).toBe(true);
  expect(await page.evaluate(()=>document.cookie.includes('smm_session'))).toBe(false);
  const me = await request.get('/api/auth/me', {
    headers: { Authorization: 'Bearer ' + token },
  });
  expect(me.ok()).toBeTruthy();
  expect(
    (
      await request.post('/api/auth/logout', {
        headers: { Authorization: 'Bearer ' + token },
      })
    ).ok()
  ).toBeTruthy();
  expect(
    (
      await request.get('/api/auth/me', {
        headers: { Authorization: 'Bearer ' + token },
      })
    ).status()
  ).toBe(401);
});
test('HTML de cliente não executa no administrativo', async ({
  page,
  request,
}) => {
  const r = await request.post('/api/auth/register', {
    data: {
      name: '<img src=x onerror="window.__regressionMarker=1">',
      email: 'xss-' + Date.now() + '@e2e.invalid',
      password: 'E2E-password-12345',
      consent_terms: true,
    },
  });
  expect(r.status()).toBe(201);
  const login = await request.post('/api/auth/login', {
    data: { email: 'admin@e2e.invalid', password: 'E2E-password-12345' },
  });
  const { token } = await login.json();
  await page.addInitScript((t) => localStorage.setItem('smm_token', t), token);
  await page.goto('/admin.html');
  await page.evaluate(() => loadUsers());
  await expect(page.locator('#u-tbl')).toContainText('<img src=x');
  expect(await page.evaluate(() => window.__regressionMarker)).toBeUndefined();
});
test('configuração de integração não retorna segredos', async ({ request }) => {
  const login = await request.post('/api/auth/login', {
    data: { email: 'admin@e2e.invalid', password: 'E2E-password-12345' },
  });
  const { token } = await login.json();
  const r = await request.get('/api/admin/integrations', {
    headers: { Authorization: 'Bearer ' + token },
  });
  expect(r.ok()).toBeTruthy();
  expect((await r.json()).fields['pix.mp.accessToken']).toEqual({
    configured: false,
  });
});
