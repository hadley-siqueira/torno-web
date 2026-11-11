import { expect } from '@playwright/test';

let seq = 0;
/** Nome de usuário único por teste (o banco é compartilhado durante a execução). */
export const uniqueUser = (prefix = 'u') => `${prefix}_${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** Cria conta pela tela de cadastro e espera o simulador abrir. */
export async function signup(page, { username = uniqueUser(), name = 'Aluno Teste', password = 'senha123', from = '/signup.html' } = {}) {
  await page.goto(from);
  await page.fill('#name', name);
  await page.fill('#username', username);
  await page.fill('#password', password);
  await page.fill('#password2', password);
  await page.click('button[type=submit]');
  // espera o redirecionamento do cadastro (ou a mensagem de erro) antes de seguir
  await Promise.race([
    page.waitForURL((u) => !u.pathname.endsWith('/signup.html'), { timeout: 30_000, waitUntil: 'commit' }),
    page.locator('#error:not(:empty)').waitFor({ timeout: 30_000 }).catch(() => {}),
  ]);
  return { username, password, name };
}

export async function openSimulator(page) {
  await expect(page.locator('#code')).toBeVisible();
  // espera o exemplo inicial terminar de carregar
  // (a 1ª carga do Three.js com WebGL por software pode passar de 15 s com outros testes rodando)
  await expect(page.locator('#messages')).toContainText(/carregado|loaded|restaurado|restored/, { timeout: 60_000 });
}

export async function setCode(page, code) {
  await page.locator('#code').fill(code);
}

export const status = (page) => page.locator('#statusState');

export async function runToEnd(page) {
  await page.click('#btnReset');
  await page.click('#btnFinish');
  await expect(status(page)).toHaveText(/FIM|ALARME|END|ALARM/, { timeout: 90_000 });
}
