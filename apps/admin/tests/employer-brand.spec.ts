import { readFile } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 1000 } });

const enterprise = {
  id: 1,
  name: '背书回归测试企业',
  industry: '医药健康',
  introduction: '从事医药产品研发、生产及销售。',
  remark: '内部备注需要保留',
  sort_order: 6,
  enabled: true,
  deleted_at: null,
  endorsement_count: 3,
  completed_categories: 2,
  updated_at: '2026-10-02T00:00:00Z',
};

const endorsements = [
  {
    category: 'company_introduction',
    category_label: '公司简介',
    title: '公司"简介"',
    enterprise_id: 1,
  },
  { category: 'culture', category_label: '企业文化', title: '诚信与协作', enterprise_id: 1 },
  { category: 'culture', category_label: '企业文化', title: '持续学习', enterprise_id: 1 },
  { category: 'team', category_label: '团队介绍', title: '第二家企业专属内容', enterprise_id: 2 },
].map((item, index) => ({
  ...item,
  id: index + 1,
  enterprise_name: item.enterprise_id === 1 ? enterprise.name : '另一家已停用企业',
  enterprise_deleted: false,
  body: '第一行正文。\n第二行正文。',
  sort_order: index,
  enabled: true,
  updated_at: enterprise.updated_at,
}));

async function openBrand(page: Page) {
  const state = {
    enterprises: [
      { ...enterprise },
      {
        ...enterprise,
        id: 2,
        name: '另一家已停用企业',
        enabled: false,
        endorsement_count: 1,
        completed_categories: 1,
      },
    ],
    saves: [] as Record<string, unknown>[],
    loads: 0,
    failSave: false,
  };
  // 全部 API 都在浏览器中模拟；不会登录或写入本地真实企业档案。
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/auth/csrf/') {
      await route.fulfill({ json: { csrfToken: 'mock-csrf', home_url: '/' } });
    } else if (path === '/api/v1/me/') {
      await route.fulfill({
        json: {
          name: '界面验收用户',
          avatar_url: '',
          auth_source: 'local',
          organization: '验收组织',
          roles: ['hr'],
          departments: [],
        },
      });
    } else if (path === '/api/v1/employer-brand/') {
      state.loads += 1;
      await route.fulfill({
        json: {
          enterprise_limit: 20,
          enterprises: state.enterprises,
          deleted_enterprises: [],
          endorsements,
        },
      });
    } else if (path === '/api/v1/employer-brand/enterprises/save/') {
      const body = route.request().postDataJSON();
      state.saves.push(body);
      if (state.failSave) {
        await route.fulfill({
          status: 503,
          json: { errors: { detail: '状态保存失败，请重试。' } },
        });
      } else {
        const item = state.enterprises.find((row) => row.id === body.id);
        Object.assign(item!, body);
        // 保存接口不计算内容数；页面应重新获取工作区中的真实计数。
        await route.fulfill({ json: { ...item, endorsement_count: 0, completed_categories: 0 } });
      }
    } else {
      await route.fulfill({ status: 501, json: { errors: { detail: `未模拟接口：${path}` } } });
    }
  });
  await page.goto(`${process.env.EMPLOYER_BRAND_TEST_URL || ''}/#employer-brand`);
  await expect(page.locator('.enterprise-card')).toHaveCount(2);
  return state;
}

test('企业编号搜索和中文状态筛选显示匹配卡片', async ({ page }, testInfo) => {
  await openBrand(page);
  await page.screenshot({ path: testInfo.outputPath('企业列表-桌面.png'), fullPage: true });
  const search = page.getByRole('textbox', { name: '搜索企业名称、行业或编号' });
  await search.fill('E0001');
  await expect(page.locator('.enterprise-card')).toHaveCount(1);
  await expect(page.locator('.enterprise-card')).toContainText(enterprise.name);
  await page.getByRole('button', { name: '重置', exact: true }).click();
  const status = page.getByRole('combobox', { name: '按企业状态筛选' });
  await expect(status).toContainText('全部状态');
  await status.click();
  await page.getByRole('option', { name: /已停用$/ }).click();
  await expect(status).toContainText('已停用');
  await expect(page.locator('.enterprise-card')).toHaveCount(1);
  await expect(page.locator('.enterprise-card')).toContainText('另一家已停用企业');
  await status.click();
  await page.getByRole('option', { name: /已启用$/ }).click();
  await expect(status).toContainText('已启用');
  await expect(page.locator('.enterprise-card')).toHaveCount(1);
  await expect(page.locator('.enterprise-card')).toContainText(enterprise.name);
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出企业列表', exact: true }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toMatch(/^企业列表-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = await readFile((await download.path())!, 'utf8');
  expect(csv).toContain('"企业编号","企业名称"');
  expect(csv).toContain('"背书内容数","已补充分类数"');
  expect(csv.split('\r\n').find((line) => line.startsWith('"E0001",'))).toContain(
    '"已启用","3","2"',
  );
});

test('启停发送完整档案并刷新计数，失败时保留原状态和资料', async ({ page }, testInfo) => {
  const state = await openBrand(page);
  const card = page.locator('.enterprise-card').filter({ hasText: enterprise.name });
  const { id, name, industry, introduction, remark, sort_order } = enterprise;
  for (const enabled of [false, true]) {
    const previousLoads = state.loads;
    await card.getByRole('button', { name: enabled ? '启用' : '停用', exact: true }).click();
    await expect
      .poll(() => state.saves.at(-1))
      .toEqual({
        id,
        name,
        industry,
        introduction,
        remark,
        sort_order,
        enabled,
      });
    await expect.poll(() => state.loads).toBeGreaterThan(previousLoads);
    await expect(card).toContainText(enabled ? '已启用' : '已停用');
    await expect(card).toContainText('3 条内容');
    await expect(card).toContainText(/2\s*\/\s*7/);
  }
  state.failSave = true;
  await card.getByRole('button', { name: '停用', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('状态保存失败');
  await expect(card).toContainText('已启用');
  await expect(card).toContainText('3 条内容');
  await card.getByRole('button', { name: '编辑', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('企业名称', { exact: false })).toHaveValue(name);
  await expect(dialog.getByLabel('企业简介', { exact: false })).toHaveValue(introduction);
  await expect(dialog.getByLabel('备注', { exact: false })).toHaveValue(remark);
  await expect(dialog.getByLabel('排序', { exact: true })).toHaveValue(String(sort_order));
  expect(state.enterprises[0]).toEqual(enterprise);
  const box = await dialog.boundingBox();
  expect(box!.width).toBe(420);
  expect(Math.abs(box!.x + box!.width / 2 - 720)).toBeLessThanOrEqual(1);
  expect(Math.abs(box!.y + box!.height / 2 - 500)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath('编辑企业-桌面.png'), fullPage: true });
});

test('前三类新增内容预选当前企业与分类，弹窗居中且窄屏无横向溢出', async ({ page }, testInfo) => {
  await openBrand(page);
  await page
    .locator('.enterprise-card')
    .filter({ hasText: enterprise.name })
    .locator('.enterprise-card-open')
    .click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出该企业内容', exact: true }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toMatch(/^E0001-背书内容-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = await readFile((await download.path())!, 'utf8');
  expect(csv).toContain('"企业编号","企业名称","分类","标题","正文","展示顺序","状态"');
  expect(csv.match(/"E0001"/g)).toHaveLength(3);
  expect(csv).toContain('"公司""简介"""');
  expect(csv).toContain('"第一行正文。\n第二行正文。"');
  expect(csv).not.toContain('第二家企业专属内容');
  const dialog = page.getByRole('dialog');
  for (const category of ['公司简介', '企业文化', '福利待遇']) {
    const section = page.locator('.endorsement-category-card').filter({
      has: page.getByRole('heading', { name: category, exact: true }),
    });
    await section.getByRole('button', { name: '新增', exact: true }).click();
    await expect(dialog.locator('#endorsement-enterprise')).toContainText(enterprise.name);
    await expect(dialog.locator('#endorsement-category')).toContainText(category);
    await expect(dialog.getByLabel('正文', { exact: false })).toHaveValue('');
    if (category === '公司简介') {
      const box = await dialog.boundingBox();
      expect(Math.abs(box!.x + box!.width / 2 - 720)).toBeLessThanOrEqual(1);
      expect(Math.abs(box!.y + box!.height / 2 - 500)).toBeLessThanOrEqual(1);
      await page.screenshot({ path: testInfo.outputPath('新增内容-桌面.png'), fullPage: true });
    }
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
  }
  await page.getByRole('button', { name: '返回企业列表' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('企业列表-窄屏.png'), fullPage: true });
  await page
    .locator('.enterprise-card')
    .filter({ hasText: enterprise.name })
    .locator('.enterprise-card-open')
    .click();
  await page
    .locator('.endorsement-category-card')
    .first()
    .getByRole('button', { name: '新增', exact: true })
    .click();
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(Math.abs(box!.x + box!.width / 2 - 195)).toBeLessThanOrEqual(1);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  for (const name of ['取消', '保存']) {
    const buttonBox = await dialog.getByRole('button', { name, exact: true }).boundingBox();
    expect(buttonBox!.y).toBeGreaterThanOrEqual(0);
    expect(buttonBox!.y + buttonBox!.height).toBeLessThanOrEqual(844);
    expect(buttonBox!.x).toBeGreaterThanOrEqual(0);
    expect(buttonBox!.x + buttonBox!.width).toBeLessThanOrEqual(390);
  }
  await page.screenshot({ path: testInfo.outputPath('新增内容-窄屏.png'), fullPage: true });
  const body = dialog.locator('.enterprise-dialog-body');
  expect(await body.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await body.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  expect(await body.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(
    (await dialog.getByLabel('正文', { exact: false }).boundingBox())!.height,
  ).toBeGreaterThanOrEqual(170);
  expect(
    (await dialog.getByLabel('标题', { exact: false }).boundingBox())!.height,
  ).toBeGreaterThanOrEqual(40);
  const saveBox = await dialog.getByRole('button', { name: '保存', exact: true }).boundingBox();
  expect(saveBox!.y + saveBox!.height).toBeLessThanOrEqual(844);
  await page.screenshot({ path: testInfo.outputPath('新增内容-窄屏正文滚动.png'), fullPage: true });
});
