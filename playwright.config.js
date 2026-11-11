// Testes de ponta a ponta no navegador: npm run test:e2e
// O servidor sobe com banco em memória (nada é gravado em disco).
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT) || 3199;

export default defineConfig({
  testDir: 'test/e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 2, // WebGL por software é pesado; mais processos deixam os testes lentos e instáveis
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: 'pt-BR',
    viewport: { width: 1400, height: 880 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // WebGL por software (funciona sem placa de vídeo, inclusive no CI)
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  webServer: {
    command: 'node server.js',
    url: `http://127.0.0.1:${PORT}/login.html`,
    reuseExistingServer: false,
    env: { PORT: String(PORT), DB_PATH: ':memory:', SIGNUPS_PER_HOUR: '10000', ADMIN_USERNAMES: 'e2e_admin' },
  },
});
