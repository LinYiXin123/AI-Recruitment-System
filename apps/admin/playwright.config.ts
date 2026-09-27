import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

if (existsSync('../api/.env')) loadEnvFile('../api/.env');
const uv = process.env.UV_BIN || `${process.env.HOME}/.local/bin/uv`;
const env = {
  ...process.env,
  PGDATABASE: 'recruitment_e2e',
  PRIVATE_RESUME_ROOT: fileURLToPath(new URL('../../.local/e2e-resumes', import.meta.url)),
  DJANGO_DEBUG: '1',
  LOCAL_ACCOUNT_PASSWORD: 'only-e2e-password-123',
  DJANGO_SECRET_KEY: 'e2e-only-key-not-for-deployment',
  PUBLIC_HOME_URL: 'http://127.0.0.1:5176/',
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
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 5176 --strictPort',
      cwd: '../web',
      env: { API_TARGET: 'http://127.0.0.1:8101' },
      url: 'http://127.0.0.1:5176',
      reuseExistingServer: false,
    },
  ],
});
