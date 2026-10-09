import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('局域网 HTTP 缺少 randomUUID 时，起草招人要求仍可打开并生成有效请求编号', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(crypto, 'randomUUID', {
      value: undefined,
      writable: true,
      configurable: true,
    });
  });
  await login(page);
  await page.goto('/#talent-profiles');
  await page.getByRole('button', { name: 'AI 起草招人要求', exact: true }).click();
  const draft = page.getByRole('dialog', { name: 'AI 起草招人要求' });
  await expect(draft.getByLabel('你想招什么样的人？')).toBeVisible();
  const ids = await page.evaluate(() => Array.from({ length: 64 }, () => crypto.randomUUID()));
  expect(new Set(ids).size).toBe(ids.length);
  for (const id of ids) {
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  }
  await draft.getByRole('button', { name: '取消', exact: true }).click();
  await expect(draft).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '人才画像', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('已有原生 randomUUID 时保持浏览器实现', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, '__originalRandomUUID', { value: crypto.randomUUID });
  });
  await login(page);
  expect(
    await page.evaluate(
      () =>
        typeof crypto.randomUUID === 'function' &&
        crypto.randomUUID === Reflect.get(window, '__originalRandomUUID'),
    ),
  ).toBe(true);
});
