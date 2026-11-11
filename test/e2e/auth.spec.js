import { test, expect } from '@playwright/test';
import { signup, uniqueUser, openSimulator } from './helpers.js';

test('sem login vai para a tela de login e volta para onde estava', async ({ page }) => {
  await page.goto('/turmas.html');
  await expect(page).toHaveURL(/login\.html\?next=%2Fturmas\.html/);
  await page.click('#toSignup');
  await expect(page).toHaveURL(/signup\.html\?next=/);
  await signup(page, { from: page.url() });
  await expect(page).toHaveURL(/turmas\.html/);
});

test('cadastro, sair e entrar de novo', async ({ page }) => {
  const user = await signup(page, { name: 'Maria Teste' });
  await openSimulator(page);
  await expect(page.locator('#userName')).toHaveText('Maria Teste');
  await page.click('#userName');
  await page.click('#btnLogout');
  await expect(page).toHaveURL(/login\.html/);

  await page.fill('#username', user.username);
  await page.fill('#password', 'errada');
  await page.click('button[type=submit]');
  await expect(page.locator('#error')).toHaveText('Usuário ou senha inválidos');

  await page.fill('#password', user.password);
  await page.click('button[type=submit]');
  await openSimulator(page);
});

test('cadastro recusa usuário repetido e senhas diferentes', async ({ page }) => {
  const username = uniqueUser();
  await signup(page, { username });
  await openSimulator(page);
  await page.context().clearCookies();

  await page.goto('/signup.html');
  await page.fill('#name', 'Outro');
  await page.fill('#username', username);
  await page.fill('#password', 'senha123');
  await page.fill('#password2', 'senha124');
  await page.click('button[type=submit]');
  await expect(page.locator('#error')).toHaveText('As senhas não conferem');
  await page.fill('#password2', 'senha123');
  await page.click('button[type=submit]');
  await expect(page.locator('#error')).toHaveText('Esse nome de usuário já existe');
});

test('trocar senha', async ({ page }) => {
  const user = await signup(page);
  await openSimulator(page);
  await page.click('#userName');
  await page.click('#btnPassword');
  await page.fill('#pwCurrent', user.password);
  await page.fill('#pwNext', 'outra-senha');
  await page.click('#formPassword button[type=submit]');
  await expect(page.locator('#messages')).toContainText('Senha alterada');
  await page.context().clearCookies();
  await page.goto('/login.html');
  await page.fill('#username', user.username);
  await page.fill('#password', 'outra-senha');
  await page.click('button[type=submit]');
  await openSimulator(page);
});
