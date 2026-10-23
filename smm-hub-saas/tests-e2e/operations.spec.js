const { test, expect } = require('@playwright/test');
async function login(request) {
  const r = await request.post('/api/auth/login', {
    data: { email: 'admin@e2e.invalid', password: 'E2E-password-12345' },
  });
  return (await r.json()).token;
}
test('Abas operacionais retornam dados e sessão fica íntegra no celular', async ({
  page,
  request,
}) => {
  const token = await login(request);
  for (const name of [
    'scheduled',
    'giveaways',
    'challenges',
    'combos',
    'invoices',
    'jobs',
  ]) {
    const r = await request.get('/api/admin/operations/' + name, {
      headers: { Authorization: 'Bearer ' + token },
    });
    expect(r.status(), name).toBe(200);
    expect(Array.isArray((await r.json()).rows)).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript((t) => localStorage.setItem('smm_token', t), token);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', (route) =>
    ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname)
      ? route.continue()
      : route.abort()
  );
  await page.goto('/');
  await page.waitForFunction(
    () => typeof state !== 'undefined' && state.user?.role === 'ceo'
  );
  expect(errors).toEqual([]);
});
test('Integrações têm formulário funcional de CEO', async ({
  page,
  request,
}) => {
  const token = await login(request);
  await page.addInitScript((t) => localStorage.setItem('smm_token', t), token);
  await page.goto('/admin.html');
  await page
    .getByRole('button', { name: 'Integrações de pagamento', exact: true })
    .click();
  await expect(page.locator('#pane-integrations')).toContainText(
    'Sua senha atual'
  );
  await expect(page.locator('#pane-integrations select')).toHaveCount(2);
});

test('Central operacional pagina, protege segredos e mostra estados reais',async({page,request})=>{
const token=await login(request);await page.addInitScript(t=>localStorage.setItem('smm_token',t),token);const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/operations.html');await expect(page.locator('#feedback')).toHaveText('Dados atualizados.');for(const resource of ['mail','providers','campaigns','commissions','audit']){await page.locator('#resource').selectOption(resource);await expect(page.locator('#feedback')).toHaveText('Dados atualizados.');}const result=await request.get('/api/admin/center/providers?limit=1',{headers:{Authorization:'Bearer '+token}});expect(result.ok()).toBeTruthy();const dto=await result.json();expect(dto.rows).toHaveLength(1);expect(dto.rows[0].api_key).toBeUndefined();expect((await request.get('/api/admin/center/providers?limit=-1',{headers:{Authorization:'Bearer '+token}})).status()).toBe(400);expect(errors).toEqual([]);
});
