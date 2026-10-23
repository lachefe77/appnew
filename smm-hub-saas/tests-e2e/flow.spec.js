const { test, expect } = require('@playwright/test');

test('vitrine carrega e mostra serviços', async ({ page }) => {
  await page.goto('/vitrine.html');
  await expect(page).toHaveTitle(/SMM Hub/i);
});

test('health retorna ok', async ({ request }) => {
  const r = await request.get('/health');
  expect(r.ok()).toBeTruthy();
  const data = await r.json();
  expect(data.status).toBe('ok');
});

test('login admin funciona', async ({ request }) => {
  const r = await request.post('/api/auth/login', {
    data: { email: 'admin@e2e.invalid', password: 'E2E-password-12345' },
  });
  expect(r.ok()).toBeTruthy();
  const data = await r.json();
  expect(data.token).toBeTruthy();
});
