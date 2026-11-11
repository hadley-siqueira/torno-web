import { test, expect } from '@playwright/test';
import { signup, openSimulator } from './helpers.js';

test('professor cria turma, aluno entra pelo link, entrega e o professor lê', async ({ browser }) => {
  const prof = await (await browser.newContext({ locale: 'pt-BR' })).newPage();
  await signup(prof, { name: 'Prof. Teste' });
  await openSimulator(prof);
  await prof.goto('/turmas.html');
  await prof.fill('#newName', 'Turma E2E');
  await prof.click('#formCreate button');
  const link = await prof.locator('.invite').inputValue();
  expect(link).toMatch(/\/join\.html\?code=[A-Z2-9]{8}$/);

  // aluno sem conta abre o convite, cria conta e volta ao convite
  const aluno = await (await browser.newContext({ locale: 'pt-BR' })).newPage();
  await aluno.goto(link);
  await expect(aluno).toHaveURL(/login\.html/);
  await aluno.click('#toSignup');
  await signup(aluno, { name: 'Aluna Teste', from: aluno.url() });
  await expect(aluno.locator('#text')).toHaveText('Você foi convidado(a) para a turma Turma E2E, de Prof. Teste.');
  await aluno.click('#btnJoin');
  await expect(aluno.locator('#error')).toHaveText('Você entrou na turma Turma E2E.');

  // entrega exige programa salvo
  aluno.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'ENTREGA.MPF' : undefined));
  await aluno.goto('/');
  await openSimulator(aluno);
  await aluno.click('#btnSubmit');
  await expect(aluno.locator('#messages')).toContainText('Salve o programa antes de entregar.');
  await aluno.click('#btnSave');
  await expect(aluno.locator('#progName')).toHaveText('ENTREGA.MPF');
  await aluno.click('#btnSubmit');
  await aluno.click('#formSubmit button[type=submit]');
  await expect(aluno.locator('#messages')).toContainText('Programa ENTREGA.MPF entregue na turma Turma E2E');

  // professor vê aluno e entrega
  await prof.reload();
  const card = prof.locator('.turma-card', { hasText: 'Turma E2E' });
  await expect(card).toContainText('Alunos: 1 · Entregas: 1');
  await card.locator('summary').click();
  await card.locator('.turma-details table').last().getByRole('button', { name: 'Ver' }).click();
  await expect(prof.locator('#codeTitle')).toHaveText('ENTREGA.MPF');
  await expect(prof.locator('#codeView')).toHaveValue(/EIXO ESCALONADO/);
  await expect(prof.locator('#codeInfo')).toContainText('Aluna Teste');
});

test('novo código de convite invalida o link antigo', async ({ browser }) => {
  const prof = await (await browser.newContext({ locale: 'pt-BR' })).newPage();
  await signup(prof);
  await prof.goto('/turmas.html');
  await prof.fill('#newName', 'Turma Código');
  await prof.click('#formCreate button');
  const old = await prof.locator('.invite').inputValue();
  prof.on('dialog', (d) => d.accept());
  await prof.getByRole('button', { name: 'Gerar novo código' }).click();
  await expect(prof.locator('.invite')).not.toHaveValue(old);

  const aluno = await (await browser.newContext({ locale: 'pt-BR' })).newPage();
  await signup(aluno);
  await aluno.goto(old);
  await expect(aluno.locator('#error')).toHaveText('Convite inválido ou desativado');
});
