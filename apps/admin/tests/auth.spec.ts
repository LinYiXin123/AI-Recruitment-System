import { expect, test } from '@playwright/test';
import { login } from './helpers';

const home = 'http://127.0.0.1:5176/';

test('未登录直接访问工作台返回首页，不显示账号密码页', async ({ page }) => {
  await page.goto('/#jobs');
  await expect(page).toHaveURL(home);
  await expect(page.getByRole('link', { name: '开启知遇之旅' })).toHaveAttribute(
    'href',
    '/api/v1/auth/login/',
  );
  await expect(page.getByLabel('密码', { exact: true })).toHaveCount(0);
});

test('退出后回首页且再次访问与浏览器后退都不能恢复工作台', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: '职位', exact: true }).click();
  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page).toHaveURL(home);
  expect((await page.request.get('/api/v1/me/')).status()).toBe(403);
  await page.goBack();
  await expect(page).toHaveURL(home);
  await page.goto('/#today');
  await expect(page).toHaveURL(home);
});

test('会话过期刷新返回首页，服务故障则留在重试提示', async ({ page, context }) => {
  await login(page);
  await context.clearCookies();
  await page.reload();
  await expect(page).toHaveURL(home);
  await page.route('**/api/v1/me/', (route) =>
    route.fulfill({ status: 503, json: { errors: { detail: '服务暂时不可用，请重试。' } } }),
  );
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('服务暂时不可用');
  await expect(page.getByRole('button', { name: '重新加载' })).toBeVisible();
  await expect(page.getByRole('link', { name: '返回首页' })).toHaveAttribute('href', home);
  await page.unroute('**/api/v1/me/');
  await page.getByRole('button', { name: '重新加载' }).click();
  await expect(page).toHaveURL(home);
});

test('退出失败保留当前账号并显示错误，重试成功后才返回首页', async ({ page }) => {
  await login(page);
  await page.route('**/api/v1/auth/logout/', (route) =>
    route.fulfill({ status: 503, json: { errors: { detail: '退出暂未完成，请重试。' } } }),
  );
  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page.getByRole('alert')).toContainText('退出暂未完成');
  await expect(page.getByRole('heading', { name: '招聘总览' })).toBeVisible();
  expect((await page.request.get('/api/v1/me/')).status()).toBe(200);
  await page.unroute('**/api/v1/auth/logout/');
  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page).toHaveURL(home);
});

test('飞书姓名头像与真实角色显示，缺失头像及窄屏长姓名有回退', async ({ page }) => {
  // 仅模拟飞书资料显示；真实授权交换、身份绑定与权限由后端测试覆盖。
  let avatar = 'https://avatar.example.test/fixture.svg';
  let name = '林小遇（验收虚构用户）';
  await page.route('**/api/v1/me/', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { ...(await response.json()), name, avatar_url: avatar, auth_source: 'feishu' },
    });
  });
  await page.route('https://avatar.example.test/fixture.svg', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#2656b9"/><circle cx="20" cy="14" r="7" fill="white"/><path d="M7 38a13 13 0 0 1 26 0" fill="white"/></svg>',
    }),
  );
  await login(page);
  const profile = page.locator('.account-profile');
  await expect(profile).toContainText(name);
  await expect(profile.locator('small')).toContainText('HR');
  await expect(page.getByAltText(`${name}的头像`)).toBeVisible();
  await expect(page.getByText('本地体验', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('status', { name: '正在加载' })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/飞书账号展示.png' });
  await page.route('https://avatar.example.test/fixture.svg', (route) => route.abort());
  await page.reload();
  await expect(profile.locator('[data-slot="avatar-fallback"]')).toHaveText('林');
  avatar = '';
  name = '林小遇与招聘协作团队的较长姓名展示验收';
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(profile.locator('.account-name')).toHaveAttribute('title', name);
  await expect(profile.locator('[data-slot="avatar-fallback"]')).toHaveText('林');
  await expect(page.getByRole('button', { name: '退出登录' })).toBeVisible();
  await expect(page.getByRole('status', { name: '正在加载' })).toHaveCount(0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: 'test-results/飞书账号窄屏.png' });
});
