import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('招聘总览按原型呈现完整侧栏、六项指标和真实导出', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1493, height: 799 });
  await login(page);

  const sidebar = page.getByRole('complementary', { name: '侧边栏' });
  await expect(sidebar).toBeVisible();
  expect(await sidebar.evaluate((element) => element.getBoundingClientRect().width)).toBe(236);
  for (const label of [
    '招聘总览',
    '职位管理',
    '候选人库',
    '面试管理',
    'AI 初面',
    '面试题库',
    '企业背书',
    '在职人员管理',
  ]) {
    await expect(sidebar.getByText(label, { exact: true })).toBeVisible();
  }

  const overview = page.getByRole('region', { name: '招聘概览' });
  await expect(overview.locator('.dashboard-kpi')).toHaveCount(6);
  for (const label of [
    '人才库总数',
    '当日新增简历',
    '今日面试安排',
    '本周 offer 发放',
    '待入职人数',
    '已入职',
  ]) {
    await expect(overview.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(page.getByRole('heading', { name: '近 14 天每日新增简历' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '入职分析' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '候选人状态分布' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '今日面试安排' })).toBeVisible();
  await expect(page.getByText('Offer 流程尚未接通', { exact: true })).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出全部数据' }).click();
  await expect((await download).suggestedFilename()).toMatch(/^招聘总览-\d{4}-\d{2}-\d{2}\.csv$/);

  await sidebar.getByRole('button', { name: /体验 HR/ }).click();
  await expect(page.getByRole('heading', { name: '飞书个人信息' })).toBeVisible();
  await expect(page.getByText('当前使用本地体验身份，未连接飞书头像。')).toBeVisible();
  await page.getByRole('button', { name: '关闭详情' }).click();

  await sidebar.getByRole('button', { name: '在职人员管理' }).click();
  await expect(sidebar.getByText('全部在职', { exact: true })).toBeVisible();
  await expect(sidebar.getByText('未关联企业', { exact: true })).toBeVisible();
  await sidebar.getByRole('button', { name: '在职人员管理' }).click();

  await sidebar.getByRole('link', { name: '面试题库' }).click();
  await expect(page.getByRole('heading', { name: '面试题库尚未接通' })).toBeVisible();
  await page.getByRole('button', { name: '返回招聘总览' }).click();
  await expect(page.getByRole('heading', { name: '招聘总览' })).toBeVisible();
  await expect(page.getByRole('region', { name: '招聘概览' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('招聘总览-桌面.png') });
});

test('窄屏使用原型同款顶栏、飞书头像和遮罩侧栏', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 879, height: 738 });
  await login(page);

  await expect(page.getByRole('complementary', { name: '侧边栏' })).toBeHidden();
  await expect(page.getByRole('button', { name: '菜单' })).toBeVisible();
  await expect(page.getByRole('button', { name: '打开飞书个人设置' })).toBeVisible();
  await expect(page.locator('.dashboard-kpi-grid')).toHaveCSS(
    'grid-template-columns',
    /\S+px \S+px \S+px/,
  );

  await page.getByRole('button', { name: '菜单' }).click();
  const drawer = page.getByRole('dialog', { name: '招聘工作台菜单' });
  await expect(drawer).toBeVisible();
  expect(
    await drawer.evaluate((element) => element.getBoundingClientRect().width),
  ).toBeLessThanOrEqual(344);
  await expect(drawer.getByText('AI 初面', { exact: true })).toBeVisible();
  await expect(drawer.getByText('企业背书', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('招聘总览-移动侧栏.png'), fullPage: true });

  await drawer.getByRole('link', { name: '今天' }).click();
  await expect(drawer).toBeHidden();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
});
