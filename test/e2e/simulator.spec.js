import { test, expect } from '@playwright/test';
import { signup, openSimulator, setCode, status, runToEnd } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await signup(page);
  await openSimulator(page);
});

test('a cena 3D é desenhada (WebGL)', async ({ page }) => {
  const canvas = page.locator('#viewport canvas');
  await expect(canvas).toBeVisible();
  // a imagem do canvas não pode ser uma cor só
  const png = await canvas.screenshot();
  const distinct = new Set();
  for (let i = 0; i < png.length; i += 997) distinct.add(png[i]);
  expect(distinct.size).toBeGreaterThan(20);
});

test('exemplo roda até o fim, separa a peça e mostra o tempo', async ({ page }) => {
  await page.selectOption('#programSelect', 'ex:02_eixo_sinumerik.mpf');
  await page.click('#btnOpen');
  await runToEnd(page);
  await expect(status(page)).toHaveText('FIM');
  await expect(page.locator('#messages')).toContainText('Peça separada');
  await expect(page.locator('#messages')).toContainText('Fim de programa – tempo de usinagem 1:46');
  await expect(page.locator('#droX')).toHaveText('150.000');
});

test('colisão mostra alarme, marca a linha e o Reset limpa', async ({ page }) => {
  await setCode(page, 'G18 G90 G95 DIAMON\nT1 D1\nG97 S1000 M3\nG0 X40 Z2\nG0 Z-20\nM30');
  await runToEnd(page);
  await expect(status(page)).toHaveText('ALARME');
  await expect(page.locator('#alarm')).toHaveText('⚠ Alarme – linha 5: Colisão: movimento rápido (G0) dentro do material');
  await expect(page.locator('#gutter .err')).toHaveText('5');
  await page.click('#btnReset');
  await expect(status(page)).toHaveText('RESET');
  await expect(page.locator('#alarm')).toBeHidden();
});

test('Cycle Start, Feed Hold e bloco a bloco', async ({ page }) => {
  await setCode(page, 'G18 G90 G95 DIAMON\nT1 D1\nG97 S1000 M3\nG0 X60 Z5\nG0 X58\nG0 X56\nM30');
  await page.click('#btnSingle');
  await page.click('#btnStart');
  await expect(status(page)).toHaveText('PARADO');
  await expect(page.locator('#code')).toHaveAttribute('readonly', '');
  await page.click('#btnStart');
  await expect(status(page)).toHaveText('PARADO');
  await page.click('#btnSingle'); // desliga
  await page.click('#btnStart');
  await expect(status(page)).toHaveText('FIM', { timeout: 30_000 });
  await expect(page.locator('#code')).not.toHaveAttribute('readonly', '');
});

test('salvar como, reabrir depois de recarregar e excluir', async ({ page }) => {
  page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'MEU_TESTE.MPF' : undefined));
  await setCode(page, '; meu programa\nG0 X60 Z5\nM30\n');
  await expect(page.locator('#progName')).toContainText('modificado');
  await page.click('#btnSaveAs');
  await expect(page.locator('#messages')).toContainText('Salvo como MEU_TESTE.MPF');
  await expect(page.locator('#progName')).toHaveText('MEU_TESTE.MPF');

  await page.reload();
  await expect(page.locator('#code')).toHaveValue(/meu programa/); // rascunho restaurado
  await page.selectOption('#programSelect', { label: 'MEU_TESTE.MPF' });
  await page.click('#btnOpen');
  await expect(page.locator('#code')).toHaveValue('; meu programa\nG0 X60 Z5\nM30\n');

  await page.click('#btnDelete');
  await expect(page.locator('#messages')).toContainText('Programa MEU_TESTE.MPF excluído');
  await expect(page.locator('#programSelect option', { hasText: 'MEU_TESTE.MPF' })).toHaveCount(0);
});

test('idioma inglês fica salvo na conta', async ({ page }) => {
  // as configurações são salvas com atraso: espera o servidor gravar o idioma
  const saved = page.waitForResponse(
    (r) => r.url().endsWith('/api/settings') && r.request().method() === 'PUT' && r.request().postData().includes('"lang":"en"')
  );
  await page.selectOption('#langSelect', 'en');
  await expect(page.locator('#btnFinish')).toHaveText('⏩ Run to end');
  await expect(status(page)).toHaveText('RESET');
  await saved;
  await page.reload();
  await expect(page.locator('#btnSave')).toHaveText('Save');
  await setCode(page, 'T9\nM30');
  await runToEnd(page);
  await expect(page.locator('#alarm')).toContainText('Turret station T9 is empty or does not exist');
});

test('torre configurável: posição vazia dá alarme e restaurar volta ao padrão', async ({ page }) => {
  await page.locator('summary', { hasText: 'Torre' }).click();
  await page.locator('#toolList label').nth(4).locator('select').selectOption('');
  await expect(page.locator('#messages')).toContainText('Torre alterada: T5 = — vazia —');
  await setCode(page, 'T5 D1\nM30');
  await runToEnd(page);
  await expect(page.locator('#alarm')).toContainText('Posição T5 da torre está vazia');
  await page.click('#btnReset');
  await page.getByRole('button', { name: 'Restaurar padrão' }).click();
  await runToEnd(page);
  await expect(status(page)).toHaveText('FIM');
});

test('peça bruta lida do cabeçalho do programa', async ({ page }) => {
  await page.selectOption('#programSelect', 'ex:03_bola_fanuc.nc');
  await page.click('#btnOpen');
  await expect(page.locator('#stockD')).toHaveValue('40');
  await expect(page.locator('#stockL')).toHaveValue('80');
});
