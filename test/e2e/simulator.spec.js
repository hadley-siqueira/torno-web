import { test, expect } from '@playwright/test';
import { signup, openSimulator, setCode, status, runToEnd } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await signup(page);
  await openSimulator(page);
});

test('a cena 3D é desenhada (WebGL)', async ({ page }) => {
  const canvas = page.locator('#viewport canvas:not(.rulers)');
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
  // o cabeçalho dá o comprimento em balanço (80); na tela: total = 80 + 25 nas castanhas
  await expect(page.locator('#stockT')).toHaveValue('105');
  await expect(page.locator('#stockC')).toHaveValue('25');
  await expect(page.locator('#stockDi')).toHaveValue('0');
  await expect(page.locator('#stockInfo')).toContainText('Em balanço (útil para usinar): 80 mm');
});

test('peça bruta: tubo e comprimento preso nas castanhas', async ({ page }) => {
  await page.locator('details.settings summary').first().click();
  await page.fill('#stockD', '50');
  await page.fill('#stockDi', '20');
  await page.fill('#stockT', '90');
  await page.fill('#stockC', '30');
  await expect(page.locator('#stockInfo')).toContainText('60 mm');
  await page.click('#btnApplyStock');
  // barra de mandrilar direto no tubo, sem furar antes
  await setCode(page, 'G18 G90 G95 DIAMON\nT7 D1\nG97 S800 M3\nG0 X22 Z2\nG1 Z-20 F0.1\nG0 Z5\nG0 X150 Z100\nM30');
  await runToEnd(page);
  await expect(status(page)).toHaveText('FIM');
  // inválido: Ø interno maior que o externo
  await page.fill('#stockDi', '60');
  await expect(page.locator('#stockInfo')).toContainText('Ø interno precisa ser menor');
  await page.click('#btnApplyStock');
  await expect(page.locator('#messages')).toContainText('Peça bruta inválida');
});

test('réguas na vista Lateral: lê Z e diâmetros e mede comprimento', async ({ page }) => {
  await setCode(page, `; Bruto: D50 x 80 mm, face em Z1
G18 G90 G95 DIAMON
T1 D1
G97 S1000 M3
G0 X52 Z0
G1 X-1 F0.2
G0 X40 Z2
G1 Z-20 F0.2
G1 X46
G1 Z-35
G1 X52
G0 X150 Z100
M30`);
  await runToEnd(page);
  await page.click('[data-view=side]');
  const rulers = page.locator('canvas.rulers');
  // procura com o mouse um ponto sobre o trecho Ø40 (Z entre 0 e -20)
  const vp = await page.locator('#viewport').boundingBox();
  let reading = '';
  for (let fx = 0.3; fx < 0.95 && !/ext 40\.00/.test(reading); fx += 0.01) {
    await page.mouse.move(vp.x + vp.width * fx, vp.y + vp.height * 0.45);
    reading = (await rulers.getAttribute('data-reading')) || '';
  }
  expect(reading).toMatch(/Ø ext 40\.00/);
  // clique fixa a referência; em outro trecho aparece a distância (ΔZ)
  await page.mouse.down();
  await page.mouse.up();
  // outro ponto sobre a peça (trecho Ø50 do bruto, à esquerda)
  let dz = '';
  for (let fx = 0.6; fx > 0.1 && !/ΔZ \d+\.\d\d/.test(dz); fx -= 0.02) {
    await page.mouse.move(vp.x + vp.width * fx, vp.y + vp.height * 0.45);
    dz = (await rulers.getAttribute('data-reading')) || '';
  }
  expect(dz).toMatch(/ΔZ \d+\.\d\d/);
  // fora da vista Lateral as réguas somem
  await page.click('[data-view=iso]');
  await page.mouse.move(vp.x + vp.width * 0.5, vp.y + vp.height * 0.45);
  await expect(rulers).toHaveAttribute('data-reading', '');
});

test('vistas Lateral/Face e "Peça pronta" ao fim do corte', async ({ page }) => {
  await page.selectOption('#programSelect', 'ex:05_bucha.mpf');
  await page.click('#btnOpen');
  await runToEnd(page);
  await expect(status(page)).toHaveText('FIM');
  // a peça separada aparece sozinha em destaque
  await expect(page.locator('#btnFinished')).toHaveClass(/on/);
  await expect(page.locator('#messages')).toContainText('Peça pronta em destaque');
  for (const view of ['side', 'face', 'iso']) {
    await page.click(`[data-view=${view}]`);
    await expect(page.locator(`[data-view=${view}]`)).toHaveClass(/on/);
  }
  const png = await page.locator('#viewport canvas:not(.rulers)').screenshot();
  const distinct = new Set();
  for (let i = 0; i < png.length; i += 997) distinct.add(png[i]);
  expect(distinct.size).toBeGreaterThan(20);
  // volta à máquina e o Reset limpa o destaque
  await page.click('#btnFinished');
  await expect(page.locator('#btnFinished')).not.toHaveClass(/on/);
  await page.click('#btnFinished');
  await page.click('#btnReset');
  await expect(page.locator('#btnFinished')).not.toHaveClass(/on/);
});

test('etiqueta mostra quem desenha o 3D (placa de vídeo ou software)', async ({ page }) => {
  // nos testes o WebGL é por software (SwiftShader): etiqueta laranja e aviso nas mensagens
  await expect(page.locator('#glKind')).toHaveText('Software (CPU)');
  await expect(page.locator('#glInfo')).toHaveClass(/sw/);
  await expect(page.locator('#glName')).toContainText(/SwiftShader/i);
  await expect(page.locator('#messages')).toContainText('Aceleração gráfica desligada');
  // parado, não redesenha (0 quadros/s)
  await page.waitForTimeout(2500);
  await expect(page.locator('#fps')).toHaveText('0');
});
