import { readFile } from 'node:fs/promises';
import { expect, type Page, type Route, test } from '@playwright/test';

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
  deleted_at: null as string | null,
  updated_at: enterprise.updated_at,
}));

async function openBrand(page: Page, withOrphan = false) {
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
    endorsementSaves: [] as Record<string, unknown>[],
    endorsements: endorsements.map((item) => ({ ...item })),
    pendingSuggestions: [] as Route[],
    pendingSaves: [] as (() => Promise<void>)[],
    loads: 0,
    failSave: false,
    failContentSave: false,
    holdSuggestions: false,
    holdSaves: false,
  };
  if (withOrphan) {
    state.endorsements.push({
      ...state.endorsements[0],
      id: 30,
      enterprise_id: 3,
      enterprise_name: '已删除的旧企业',
      enterprise_deleted: true,
      title: '需要重新归属的旧内容',
    });
  }
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
    } else if (path === '/api/v1/employer-brand/coordination/') {
      await route.fulfill({ json: { current_member_id: 1, jobs: [], assignees: [], issues: [] } });
    } else if (path === '/api/v1/employer-brand/') {
      state.loads += 1;
      await route.fulfill({
        json: {
          enterprise_limit: 20,
          enterprises: state.enterprises.map((item) => {
            const rows = state.endorsements.filter(
              (content) => content.enterprise_id === item.id && !content.deleted_at,
            );
            return {
              ...item,
              endorsement_count: rows.length,
              completed_categories: new Set(
                rows
                  .filter((row) => row.title.trim() || row.body.trim())
                  .map((row) => row.category),
              ).size,
            };
          }),
          deleted_enterprises: withOrphan
            ? [{ ...enterprise, id: 3, name: '已删除的旧企业', deleted_at: enterprise.updated_at }]
            : [],
          endorsements: state.endorsements.filter((item) => !item.deleted_at),
          deleted_endorsements: state.endorsements.filter((item) => item.deleted_at),
        },
      });
    } else if (path === '/api/v1/employer-brand/enterprises/save/') {
      const body = route.request().postDataJSON();
      state.saves.push(body);
      const finish = async () => {
        if (state.failSave) {
          await route.fulfill({
            status: 503,
            json: { errors: { detail: '状态保存失败，请重试。' } },
          });
        } else {
          const item = state.enterprises.find((row) => row.id === body.id);
          if (item) Object.assign(item, body);
          else state.enterprises.push({ ...enterprise, ...body, id: 10 });
          // 保存接口不计算内容数；页面应重新获取工作区中的真实计数。
          await route.fulfill({ json: { ...item, endorsement_count: 0, completed_categories: 0 } });
        }
      };
      if (state.holdSaves) state.pendingSaves.push(finish);
      else await finish();
    } else if (path === '/api/v1/employer-brand/enterprise-suggestion/') {
      if (state.holdSuggestions) state.pendingSuggestions.push(route);
      else {
        await route.fulfill({
          json: { industry: '医药健康', introduction: '从事医药产品研发、生产及销售。' },
        });
      }
    } else if (path === '/api/v1/employer-brand/endorsements/save/') {
      const body = route.request().postDataJSON();
      state.endorsementSaves.push(body);
      if (state.failContentSave) {
        await route.fulfill({
          status: 503,
          json: { errors: { detail: '内容保存失败，请重试。' } },
        });
      } else {
        let item = state.endorsements.find((row) => row.id === body.id);
        if (item) Object.assign(item, body);
        else {
          item = { ...state.endorsements[0], ...body, id: 40 };
          state.endorsements.push(item!);
        }
        const owner = state.enterprises.find((row) => row.id === item!.enterprise_id);
        if (owner) {
          item!.enterprise_deleted = false;
          item!.enterprise_name = owner.name;
        }
        await route.fulfill({ json: item });
      }
    } else if (/\/endorsements\/\d+\/(delete|restore)\/$/.test(path)) {
      const [, id, action] = path.match(/\/endorsements\/(\d+)\/(delete|restore)\/$/)!;
      const item = state.endorsements.find((row) => row.id === Number(id))!;
      item.deleted_at = action === 'delete' ? enterprise.updated_at : null;
      await route.fulfill({ json: item });
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

test('启停只提交状态并刷新计数，失败时保留原状态和资料', async ({ page }, testInfo) => {
  const state = await openBrand(page);
  const card = page.locator('.enterprise-card').filter({ hasText: enterprise.name });
  const { id, name, introduction, remark, sort_order } = enterprise;
  for (const enabled of [false, true]) {
    const previousLoads = state.loads;
    await card.getByRole('button', { name: enabled ? '启用' : '停用', exact: true }).click();
    await expect
      .poll(() => state.saves.at(-1))
      .toEqual({
        id,
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
  const dialog = page.locator('dialog.enterprise-dialog');
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
  const dialog = page.locator('dialog.enterprise-dialog');
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

test('AI 只补空白字段，修改名称或行业与关闭窗口取消旧请求', async ({ page }, testInfo) => {
  const state = await openBrand(page);
  state.holdSuggestions = true;
  const dialog = page.locator('dialog.enterprise-dialog');
  const name = dialog.getByLabel('企业名称', { exact: false });
  const introduction = dialog.getByLabel('企业简介', { exact: false });
  const industry = dialog.getByRole('combobox', { name: '行业（选填）' });
  const ai = dialog.getByRole('button', { name: 'AI 联想', exact: true });
  const reply = { industry: '医药健康', introduction: '模型返回的简介。' };

  await page.getByRole('button', { name: '新增企业', exact: true }).click();
  await name.fill('人工确认名称');
  await ai.click();
  await expect.poll(() => state.pendingSuggestions.length).toBe(1);
  await introduction.fill('人工输入的业务简介应当保留。');
  await state.pendingSuggestions[0].fulfill({ json: reply });
  await expect(dialog.getByRole('status')).toContainText('AI 建议已返回');
  await page.screenshot({ path: testInfo.outputPath('AI建议保留手填简介.png'), fullPage: true });
  await expect(industry).toContainText(reply.industry);
  await expect(introduction).toHaveValue('人工输入的业务简介应当保留。');
  await expect(ai).toBeDisabled();
  await expect(dialog.getByRole('button', { name: '创建企业', exact: true })).toBeEnabled();
  expect(state.saves).toHaveLength(0);
  page.once('dialog', (confirm) => confirm.accept());
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();

  await page.getByRole('button', { name: '新增企业', exact: true }).click();
  await name.fill('原来的企业名称');
  await ai.click();
  await expect.poll(() => state.pendingSuggestions.length).toBe(2);
  const renamedRequest = page.waitForEvent('requestfailed', {
    predicate: (request) => request.url().endsWith('/enterprise-suggestion/'),
  });
  await name.fill('改过的企业名称');
  await state.pendingSuggestions[1].fulfill({ json: reply }).catch(() => {});
  expect((await renamedRequest).failure()?.errorText).toMatch(/ABORTED|cancel/i);
  await expect(name).toHaveValue('改过的企业名称');
  await expect(introduction).toHaveValue('');
  await expect(industry).not.toContainText(reply.industry);

  await ai.click();
  await expect.poll(() => state.pendingSuggestions.length).toBe(3);
  const changedIndustryRequest = page.waitForEvent('requestfailed', {
    predicate: (request) => request.url().endsWith('/enterprise-suggestion/'),
  });
  await industry.click();
  await page.screenshot({ path: testInfo.outputPath('行业下拉-桌面.png'), fullPage: true });
  await page.getByRole('option', { name: /制造业$/ }).click();
  await expect(industry).toContainText('制造业');
  await expect(ai).toBeEnabled();
  await state.pendingSuggestions[2].fulfill({ json: reply }).catch(() => {});
  expect((await changedIndustryRequest).failure()?.errorText).toMatch(/ABORTED|cancel/i);
  await expect(industry).toContainText('制造业');
  await expect(introduction).toHaveValue('');
  page.once('dialog', (confirm) => confirm.accept());
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '新增企业', exact: true }).click();
  await name.fill('即将关闭的企业');
  await ai.click();
  await expect.poll(() => state.pendingSuggestions.length).toBe(4);
  const closedRequest = page.waitForEvent('requestfailed', {
    predicate: (request) => request.url().endsWith('/enterprise-suggestion/'),
  });
  page.once('dialog', (confirm) => confirm.accept());
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '新增企业', exact: true }).click();
  await name.fill('新窗口中的企业');
  await state.pendingSuggestions[3].fulfill({ json: reply }).catch(() => {});
  expect((await closedRequest).failure()?.errorText).toMatch(/ABORTED|cancel/i);
  await expect(name).toHaveValue('新窗口中的企业');
  await expect(introduction).toHaveValue('');
  await expect(industry).not.toContainText(reply.industry);
  await expect(ai).toBeEnabled();
  expect(state.saves).toHaveLength(0);
});

test('放弃修改需确认，保存期间锁定表单，失败后保留草稿可重试', async ({ page }, testInfo) => {
  const state = await openBrand(page);
  const card = page.locator('.enterprise-card').filter({ hasText: enterprise.name });
  await card.getByRole('button', { name: '编辑', exact: true }).click();
  const dialog = page.locator('dialog.enterprise-dialog');
  const introduction = dialog.getByLabel('企业简介', { exact: false });
  await introduction.fill('尚未保存的人工简介。');
  page.once('dialog', (confirm) => confirm.dismiss());
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(introduction).toHaveValue('尚未保存的人工简介。');
  page.once('dialog', (confirm) => confirm.accept());
  await dialog.press('Escape');
  await expect(dialog).not.toBeVisible();
  await card.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(introduction).toHaveValue(enterprise.introduction);

  state.holdSaves = true;
  state.failSave = true;
  await introduction.fill('失败后也要保留的简介。');
  await dialog.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect.poll(() => state.pendingSaves.length).toBe(1);
  await expect(dialog.getByLabel('企业名称', { exact: false })).toBeDisabled();
  await expect(introduction).toBeDisabled();
  await expect(dialog.getByLabel('排序', { exact: true })).toBeDisabled();
  await expect(dialog.getByRole('combobox')).toBeDisabled();
  await expect(dialog.getByRole('checkbox')).toBeDisabled();
  await expect(dialog.getByRole('button', { name: '关闭', exact: true })).toBeDisabled();
  await dialog.press('Escape');
  await expect(dialog).toBeVisible();
  await state.pendingSaves[0]();
  await expect(dialog.getByRole('alert')).toContainText('状态保存失败');
  await expect(introduction).toBeEnabled();
  await expect(introduction).toHaveValue('失败后也要保留的简介。');
  expect(state.enterprises[0].introduction).toBe(enterprise.introduction);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('保存失败保留草稿-手机.png'), fullPage: true });
  state.holdSaves = false;
  state.failSave = false;
  await dialog.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(state.enterprises[0].introduction).toBe('失败后也要保留的简介。');
});

test('背书内容启停失败不丢资料，删除后可从回收站完整恢复', async ({ page }, testInfo) => {
  const state = await openBrand(page);
  await page
    .locator('.enterprise-card')
    .filter({ hasText: enterprise.name })
    .locator('.enterprise-card-open')
    .click();
  const original = { ...state.endorsements[0] };
  const item = page.locator('.endorsement-item').filter({ hasText: original.title });
  await item.getByRole('button', { name: '停用', exact: true }).click();
  await expect
    .poll(() => state.endorsementSaves.at(-1))
    .toEqual({ id: original.id, enabled: false });
  await expect(item).toContainText('已停用');
  state.failContentSave = true;
  await item.getByRole('button', { name: '启用', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('内容保存失败');
  await expect(item).toContainText('已停用');
  expect(state.endorsements[0]).toEqual({ ...original, enabled: false });
  state.failContentSave = false;
  await item.getByRole('button', { name: '启用', exact: true }).click();
  await expect(item.getByRole('button', { name: '停用', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('企业内容详情-桌面.png'), fullPage: true });

  page.once('dialog', (confirm) => confirm.dismiss());
  await item.getByRole('button', { name: '删除', exact: true }).click();
  await expect(item).toBeVisible();
  page.once('dialog', (confirm) => confirm.accept());
  await item.getByRole('button', { name: '删除', exact: true }).click();
  await expect(item).toHaveCount(0);
  const recycle = page
    .locator('details')
    .filter({ has: page.locator('summary').filter({ hasText: '回收站' }) });
  await expect(recycle).toContainText(original.title);
  if ((await recycle.getAttribute('open')) === null) await recycle.locator('summary').click();
  await page.screenshot({ path: testInfo.outputPath('内容回收站-桌面.png'), fullPage: true });
  await recycle.getByRole('button', { name: '恢复', exact: true }).click();
  await expect(item).toBeVisible();
  await expect(item).toContainText(original.body);
  expect(state.endorsements[0]).toEqual(original);
  await page.getByRole('button', { name: '返回企业列表' }).click();
  await expect(page.locator('.enterprise-card').filter({ hasText: enterprise.name })).toContainText(
    '3 条内容',
  );
});

test('孤儿内容必须重新选择企业，取消保留草稿，保存后出现在目标企业', async ({ page }, testInfo) => {
  const state = await openBrand(page, true);
  const orphan = page.locator('.brand-orphan-item').filter({ hasText: '需要重新归属的旧内容' });
  await orphan.getByRole('button', { name: '重新指定', exact: true }).click();
  const dialog = page.locator('dialog.enterprise-dialog');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('所属企业');
  expect(state.endorsementSaves).toHaveLength(0);
  const body = dialog.getByLabel('正文', { exact: false });
  await body.fill('重新归属时补充的正文。');
  page.once('dialog', (confirm) => confirm.dismiss());
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(body).toHaveValue('重新归属时补充的正文。');
  await dialog.getByRole('combobox', { name: '所属企业', exact: false }).click();
  await page.screenshot({ path: testInfo.outputPath('重新指定所属企业-桌面.png'), fullPage: true });
  await page.getByRole('option', { name: /背书回归测试企业$/ }).click();
  await expect(dialog.getByRole('combobox', { name: '所属企业', exact: false })).toContainText(
    enterprise.name,
  );
  await expect(body).toBeVisible();
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect.poll(() => state.endorsementSaves.length).toBe(1);
  await expect(dialog).not.toBeVisible();
  await expect(orphan).toHaveCount(0);
  expect(state.endorsementSaves.at(-1)).toMatchObject({
    id: 30,
    enterprise_id: 1,
    body: '重新归属时补充的正文。',
  });
  await page
    .locator('.enterprise-card')
    .filter({ hasText: enterprise.name })
    .locator('.enterprise-card-open')
    .click();
  const moved = page.locator('.endorsement-item').filter({ hasText: '需要重新归属的旧内容' });
  await expect(moved).toContainText('重新归属时补充的正文。');
});
