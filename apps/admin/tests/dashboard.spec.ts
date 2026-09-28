import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('招聘总览使用真实概览与响应式工作台布局', async ({ page }, testInfo) => {
  await login(page);
  const overview = page.getByRole('region', { name: '招聘概览' });
  await expect(overview.locator('.overview-card')).toHaveCount(4);
  await expect(overview.getByText('需要我处理', { exact: true })).toBeVisible();
  await expect(overview.getByText('等待他人', { exact: true })).toBeVisible();
  await expect(overview.getByText('招聘中职位', { exact: true })).toBeVisible();
  await expect(overview.getByText('系统内面试', { exact: true })).toBeVisible();
  const mineCard = overview.getByRole('link', { name: /需要我处理/ });
  await expect(mineCard).toHaveAttribute('href', '#mine-tasks');
  await mineCard.click();
  await expect(page).toHaveURL(/#mine-tasks$/);
  await expect(page.getByRole('link', { name: '今天', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByRole('status', { name: '正在加载' })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('招聘总览.png'), fullPage: true });

  await page.getByRole('link', { name: '职位', exact: true }).click();
  await expect(page.getByRole('heading', { name: '职位管理' })).toBeVisible();
  await page.getByRole('link', { name: '今天', exact: true }).click();

  for (const viewport of [
    { width: 1024, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBeTruthy();
  }
  await expect(page.getByRole('button', { name: '退出登录' })).toBeVisible();
});
