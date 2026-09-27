import { expect, type Page } from '@playwright/test';

// 业务验收通过后端真实会话准备身份；正式用户只从公共首页发起飞书登录。
export async function login(page: Page, username = 'local_hr') {
  const csrf = await page.request.get('/api/v1/auth/csrf/');
  expect(csrf.ok()).toBeTruthy();
  const config = await csrf.json();
  const response = await page.request.post('/api/v1/auth/login/', {
    data: { username, password: 'only-e2e-password-123' },
    headers: { 'X-CSRFToken': config.csrfToken },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '从今天的重要事项开始' })).toBeVisible();
}
