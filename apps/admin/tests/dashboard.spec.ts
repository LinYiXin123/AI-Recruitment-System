import { expect, type Page, test } from '@playwright/test';
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
    '人才画像',
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
  const dailyBar = page.locator('.mini-bars').first().locator('.mini-bar-item').nth(2);
  await dailyBar.hover();
  await expect(dailyBar.locator('.mini-bar-fill')).toHaveCSS('filter', /drop-shadow/);
  await expect(dailyBar).toHaveCSS('box-shadow', 'none');
  await expect(dailyBar.locator('small')).toHaveCSS('filter', 'none');
  const unavailableBar = page.locator('.unavailable-bars .mini-bar-item').first();
  await unavailableBar.hover();
  await expect(unavailableBar.locator('.mini-bar-fill')).toHaveCSS('filter', /drop-shadow/);
  await expect(unavailableBar.locator('small')).toHaveCSS('filter', 'none');
  await expect(page.getByRole('heading', { name: '入职分析' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '候选人状态分布' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '今日面试安排' })).toBeVisible();
  await expect(page.getByText('Offer 流程尚未接通', { exact: true })).toBeVisible();
  await expect(page.locator('.dashboard-blank svg[aria-hidden="true"]')).toHaveCount(2);

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出全部数据' }).click();
  await expect((await download).suggestedFilename()).toMatch(/^招聘总览-\d{4}-\d{2}-\d{2}\.csv$/);

  await sidebar.getByRole('button', { name: /体验 HR/ }).click();
  const profileSettings = page.getByRole('dialog', { name: '个人设置' });
  await expect(profileSettings).toBeVisible();
  await expect(profileSettings.getByText('邮箱自动同步', { exact: true })).toBeVisible();
  await expect(profileSettings.getByRole('checkbox', { name: '尚未接通' })).toBeDisabled();
  await expect(profileSettings.getByLabel('邮箱地址')).toBeDisabled();
  await expect(profileSettings.getByLabel('邮箱授权码')).toBeDisabled();
  await expect(profileSettings.getByText('同步状态：邮箱服务尚未接通。')).toBeVisible();
  await profileSettings.screenshot({ path: testInfo.outputPath('个人设置弹窗.png') });
  await profileSettings.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(profileSettings).toBeHidden();

  await sidebar.getByRole('button', { name: '在职人员管理' }).click();
  await expect(sidebar.getByText('全部在职', { exact: true })).toBeVisible();
  await expect(sidebar.getByText('未关联企业', { exact: true })).toBeVisible();
  await sidebar.getByRole('button', { name: '在职人员管理' }).click();

  await sidebar.getByRole('link', { name: '面试题库' }).click();
  await expect(page.getByRole('heading', { name: '面试题库', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '新增题目' })).toBeVisible();
  await expect(page.getByText('面试题库尚未接通')).toHaveCount(0);
  await sidebar.getByRole('link', { name: '今天' }).click();
  await expect(page.getByRole('heading', { name: '招聘总览' })).toBeVisible();
  await expect(page.getByRole('region', { name: '招聘概览' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('招聘总览-桌面.png') });
});

test('人才画像紧邻候选人库且为同级入口，点击和刷新保持独立页面', async ({ page }) => {
  await login(page);
  const sidebar = page.getByRole('complementary', { name: '侧边栏' });
  const profileLink = sidebar.getByRole('link', { name: '人才画像', exact: true });
  await expect(sidebar.locator('nav > a[href="#candidates"] + a')).toHaveAttribute(
    'href',
    '#talent-profiles',
  );
  await profileLink.click();
  await expect(page).toHaveURL(/#talent-profiles$/);
  await expect(profileLink).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: '人才画像', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '人才画像尚未接入' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: '人才画像', exact: true })).toBeVisible();
  await expect(profileLink).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: '返回招聘总览' }).click();
  await expect(page.getByRole('heading', { name: '招聘总览', exact: true })).toBeVisible();
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
  await expect(drawer.locator('nav > a[href="#candidates"] + a')).toHaveText('人才画像');
  await page.screenshot({ path: testInfo.outputPath('招聘总览-移动侧栏.png'), fullPage: true });

  await drawer.getByRole('link', { name: '人才画像' }).click();
  await expect(drawer).toBeHidden();
  await expect(page.getByRole('heading', { name: '人才画像', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '打开飞书个人设置' }).click();
  const profileSettings = page.getByRole('dialog', { name: '个人设置' });
  await expect(profileSettings).toBeVisible();
  expect(
    await profileSettings.evaluate((element) => element.getBoundingClientRect().width),
  ).toBeLessThanOrEqual(859);
  await profileSettings.getByRole('button', { name: '关闭', exact: true }).click();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
});

test('浏览器 125% 对应的高像素密度桌面保持 100% 的工作台比例', async ({ browser }, testInfo) => {
  const compactContext = await browser.newContext({
    baseURL: 'http://127.0.0.1:5175',
    viewport: { width: 1195, height: 639 },
    deviceScaleFactor: 1.875,
  });
  const normalContext = await browser.newContext({
    baseURL: 'http://127.0.0.1:5175',
    viewport: { width: 1493, height: 799 },
    deviceScaleFactor: 1.5,
  });
  const measure = (page: Page) =>
    page.evaluate(() => {
      const sidebar = document.querySelector('.desktop-sidebar');
      const kpis = [...document.querySelectorAll('.dashboard-kpi')];
      const charts = [...document.querySelectorAll('.dashboard-trend-grid > *')];
      if (!sidebar || kpis.length !== 6 || charts.length !== 3) {
        throw new Error('招聘总览关键区域未加载');
      }
      return {
        zoom: getComputedStyle(document.body).zoom,
        sidebar: sidebar.getBoundingClientRect().toJSON(),
        kpis: kpis.map((card) => card.getBoundingClientRect().toJSON()),
        charts: charts.map((chart) => chart.getBoundingClientRect().toJSON()),
        scrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      };
    });
  try {
    const compactPage = await compactContext.newPage();
    const normalPage = await normalContext.newPage();
    await login(compactPage);
    await login(normalPage);
    await expect(compactPage.getByRole('region', { name: '招聘概览' })).toBeVisible();
    await expect(normalPage.getByRole('region', { name: '招聘概览' })).toBeVisible();

    const compact = await measure(compactPage);
    const normal = await measure(normalPage);
    expect(compact.zoom).toBe('0.8');
    expect(normal.zoom).toBe('1');
    expect(compact.scrollWidth).toBeLessThanOrEqual(compact.viewportWidth);

    for (const [small, full] of [
      [compact.sidebar, normal.sidebar],
      ...compact.kpis.map((rect, index) => [rect, normal.kpis[index]]),
      ...compact.charts.map((rect, index) => [rect, normal.charts[index]]),
    ]) {
      for (const dimension of ['x', 'y', 'width', 'height'] as const) {
        expect(Math.abs(small[dimension] * 1.875 - full[dimension] * 1.5)).toBeLessThan(3);
      }
    }

    await normalPage.screenshot({ path: testInfo.outputPath('招聘总览-100原比例.png') });
    await compactPage.screenshot({ path: testInfo.outputPath('招聘总览-125缩放密度.png') });
  } finally {
    await compactContext.close();
    await normalContext.close();
  }
});
