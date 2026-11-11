import { test, expect } from '@playwright/test';
import { signup, openSimulator } from './helpers.js';

test('administração: só para ADMIN_USERNAMES; desativar conta bloqueia o login', async ({ browser }) => {
  const comum = await (await browser.newContext({ locale: 'pt-BR' })).newPage();
  const user = await signup(comum, { name: 'Conta Comum' });
  await openSimulator(comum);
  await expect(comum.locator('#linkAdmin')).toBeHidden();
  await comum.goto('/admin.html');
  await expect(comum).toHaveURL(/\/$/);

  const admin = await (await browser.newContext({ locale: 'pt-BR' })).newPage();
  // e2e_admin é administrador (playwright.config.js). Numa nova tentativa a conta já existe: entra.
  await signup(admin, { username: 'e2e_admin', name: 'Admin' });
  const existing = admin.locator('#error', { hasText: 'Esse nome de usuário já existe' });
  await Promise.race([admin.locator('#code').waitFor(), existing.waitFor()]);
  if (await existing.isVisible()) {
    await admin.goto('/login.html');
    await admin.fill('#username', 'e2e_admin');
    await admin.fill('#password', 'senha123');
    await admin.click('button[type=submit]');
  }
  await openSimulator(admin);
  await expect(admin.locator('#linkAdmin')).toBeVisible();
  await admin.goto('/admin.html');
  const row = admin.locator('#usersBody tr', { hasText: user.username });
  await row.getByRole('button', { name: 'Desativar' }).click();
  await expect(row).toHaveClass(/inactive/);

  await comum.reload();
  await expect(comum).toHaveURL(/login\.html/);
});
