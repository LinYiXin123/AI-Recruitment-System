import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { defineConfig, devices } from '@playwright/test';

if (existsSync('../api/.env')) loadEnvFile('../api/.env');
const uv = process.env.UV_BIN || `${process.env.HOME}/.local/bin/uv`;
const env = {
  ...process.env,
  PGDATABASE: 'recruitment_e2e',
  DJANGO_DEBUG: '1',
  LOCAL_ACCOUNT_PASSWORD: 'only-e2e-password-123',
  DJANGO_SECRET_KEY: 'e2e-only-key-not-for-deployment',
};
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: 'http://127.0.0.1:5175',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } },
    },
  ],
  webServer: [
    {
      command: `"${uv}" run python scripts/prepare_e2e.py && "${uv}" run python manage.py runserver 127.0.0.1:8101 --noreload`,
      cwd: '../api',
      env,
      url: 'http://127.0.0.1:8101/api/v1/auth/csrf/',
      reuseExistingServer: false,
    },
    {
      command: 'npm run dev -- --port 5175',
      env: { API_TARGET: 'http://127.0.0.1:8101' },
      url: 'http://127.0.0.1:5175',
      reuseExistingServer: false,
    },
  ],
});
