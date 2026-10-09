import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('新建虚构候选人后确认删除，刷新搜索不再出现且真实接口返回 404', async ({ page }) => {
  const name = `虚构删除端到端${Date.now()}`;
  await login(page);
  await page.getByRole('link', { name: '候选人', exact: true }).click();
  await page.getByRole('button', { name: '新增候选人', exact: true }).click();
  await page.locator('#new-candidate-name').fill(name);
  await page.locator('#new-candidate-email').fill(`candidate-delete-${Date.now()}@example.com`);
  const createdResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/candidates/') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const created = await createdResponse;
  expect(created.ok(), await created.text()).toBeTruthy();
  const { candidate } = await created.json();
  expect(candidate).toBeGreaterThan(0);
  await page.getByLabel('搜索候选人').fill(name);
  const row = page.getByRole('row').filter({ hasText: name });
  await row.getByRole('button', { name: '删除', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: '删除候选人', exact: true });
  await expect(confirmation).toContainText(name);
  const deletedResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/v1/candidates/${candidate}/`) &&
      response.request().method() === 'DELETE',
  );
  await confirmation.getByRole('button', { name: '确认删除', exact: true }).click();
  const deleted = await deletedResponse;
  expect(deleted.status(), await deleted.text()).toBe(200);
  expect(await deleted.json()).toEqual({ deleted: true });
  await expect(confirmation).toBeHidden();
  await expect(row).toHaveCount(0);
  await page.reload();
  await page.getByLabel('搜索候选人').fill(name);
  await expect(page.getByText('没有符合条件的候选人', { exact: true })).toBeVisible();
  await expect(row).toHaveCount(0);
  const detail = await page.request.get(`/api/v1/candidates/${candidate}/`);
  expect(detail.status()).toBe(404);
});
