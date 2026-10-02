import { expect, type Page, test } from '@playwright/test';

const snapshot = {
  id: 1,
  name: '资料验收企业',
  industry: '医药健康',
  introduction: '本次输入的企业简介。',
  updated_at: '2026-10-03T00:00:00Z',
  endorsements: [
    {
      id: 11,
      category: 'culture',
      category_label: '企业文化',
      title: '企业文化材料',
      body: '本次输入的文化正文。',
      updated_at: '2026-10-03T00:00:00Z',
    },
  ],
};
const report = {
  id: 21,
  code: 'AI0021',
  created_at: '2026-10-03T01:00:00Z',
  candidate_name: '',
  job_title: '资料验收职位',
  enterprise_name: snapshot.name,
  enterprise_snapshot: snapshot,
  summary: '请核对简历原文。',
  match_score: null,
  conclusion: '待复核',
  follow_up_direction: '请人工核实。',
  evidence: [],
  gaps: [],
  questions: [],
  limitations: 'AI 结果仅供参考。',
};

async function openScreening(page: Page, unavailable = false) {
  const state = { requests: [] as Record<string, unknown>[], previewFails: false };
  // 全 API 模拟；不调用模型、不创建真实应聘或企业记录。
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let json: unknown;
    if (path === '/api/v1/auth/csrf/') json = { csrfToken: 'mock-csrf', home_url: '/' };
    else if (path === '/api/v1/me/')
      json = {
        name: '资料验收用户',
        avatar_url: '',
        auth_source: 'local',
        organization: '验收组织',
        roles: ['hr'],
        departments: [],
      };
    else if (path === '/api/v1/jobs/')
      json = {
        results: [
          {
            id: 10,
            title: '资料验收职位',
            enterprise_id: 1,
            enterprise_name: snapshot.name,
            enterprise_enabled: !unavailable,
            enterprise_deleted: false,
          },
          { id: 12, title: '无企业关联职位', enterprise_id: null },
        ],
        count: 2,
        next: null,
        previous: null,
      };
    else if (path === '/api/v1/applications/') json = { results: [], count: 0, next: null };
    else if (path === '/api/v1/employer-brand/enterprises/ai-options/')
      json = unavailable ? [] : [snapshot];
    else if (path === '/api/v1/employer-brand/enterprises/1/ai-context/') {
      if (state.previewFails) {
        await route.fulfill({
          status: 503,
          json: { errors: { detail: '企业资料暂时无法读取。' } },
        });
        return;
      }
      json = snapshot;
    } else if (path === '/api/v1/ai-screenings/' && route.request().method() === 'POST') {
      state.requests.push(route.request().postDataJSON());
      json = report;
    } else if (path === '/api/v1/ai-screenings/')
      json = {
        items: [
          { ...report, question_count: 0 },
          { ...report, id: 22, code: 'AI0022', question_count: 0 },
        ],
        count: 2,
        page: 1,
        page_size: 20,
      };
    else if (path === '/api/v1/ai-screenings/21/') json = report;
    else if (path === '/api/v1/ai-screenings/22/')
      json = { ...report, id: 22, code: 'AI0022', enterprise_snapshot: null };
    else {
      await route.fulfill({ status: 501, json: { errors: { detail: `未模拟接口：${path}` } } });
      return;
    }
    await route.fulfill({ json });
  });
  await page.goto('/#ai-screening');
  await expect(page.getByRole('combobox', { name: '目标职位', exact: true })).toBeEnabled();
  return state;
}

async function selectJob(page: Page, title: string) {
  await page.getByRole('combobox', { name: '目标职位', exact: true }).click();
  await page.getByRole('option', { name: new RegExp(`${title}$`) }).click();
}

test('职位自动带入企业，预览与报告保存的资料均可核对', async ({ page }, testInfo) => {
  const state = await openScreening(page);
  await selectJob(page, '资料验收职位');
  const company = page.getByRole('combobox', { name: '目标企业', exact: true });
  await expect(company).toContainText(snapshot.name);
  await expect(company).toBeDisabled();
  await page.getByText(`预览企业资料 · ${snapshot.name}`, { exact: true }).click();
  await expect(page.getByText(snapshot.endorsements[0].body, { exact: true })).toBeVisible();
  await page.locator('[contenteditable="true"]').fill('参与项目开发并负责材料整理。');
  await page.getByRole('button', { name: '开始分析', exact: true }).click();
  await expect.poll(() => state.requests.length).toBe(1);
  expect(state.requests[0]).toMatchObject({ job_id: 10, enterprise_id: 1 });
  await page.getByText(`本次使用的企业资料 · ${snapshot.name}`, { exact: true }).click();
  const result = page.getByRole('region', { name: '分析结果内容' });
  await expect(result.getByText(snapshot.introduction, { exact: true })).toBeVisible();
  await expect(
    result.getByRole('link', { name: '查看企业资料或登记问题（新页）' }),
  ).toHaveAttribute(
    'href',
    '#employer-brand?enterprise=1&source=AI+%E5%88%9D%E9%9D%A2%E6%8A%A5%E5%91%8A+AI0021',
  );
  await page.screenshot({ path: testInfo.outputPath('企业资料使用留档.png'), fullPage: true });
  await selectJob(page, '无企业关联职位');
  await expect(company).toBeEnabled();
  await expect(company).not.toContainText(snapshot.name);
});

test('停用关联企业阻止分析，不能手选另一家绕过', async ({ page }) => {
  const state = await openScreening(page, true);
  await selectJob(page, '资料验收职位');
  await expect(page.getByRole('combobox', { name: '目标企业', exact: true })).toBeDisabled();
  await page.locator('[contenteditable="true"]').fill('有完整的项目材料。');
  await page.getByRole('button', { name: '开始分析', exact: true }).click();
  await expect(
    page.getByText('职位关联的企业已停用或删除，请先在企业背书中调整关联并刷新选项。'),
  ).toBeVisible();
  expect(state.requests).toHaveLength(0);
});

test('企业预览失败可重试，失败期间保留简历且不提交分析', async ({ page }) => {
  const state = await openScreening(page);
  state.previewFails = true;
  await selectJob(page, '资料验收职位');
  await expect(page.getByText('企业资料暂时无法读取。')).toBeVisible();
  await page.locator('[contenteditable="true"]').fill('失败后仍应保留的简历材料。');
  await page.getByRole('button', { name: '开始分析', exact: true }).click();
  await expect(page.getByText('请先加载并核对企业资料，再开始分析。')).toBeVisible();
  expect(state.requests).toHaveLength(0);
  state.previewFails = false;
  await page.getByRole('button', { name: '重新加载企业资料' }).click();
  await expect(page.getByText(`预览企业资料 · ${snapshot.name}`, { exact: true })).toBeVisible();
  await expect(page.locator('[contenteditable="true"]')).toContainText(
    '失败后仍应保留的简历材料。',
  );
});

test('历史记录展示原快照，旧报告不拿当前资料伪造留档', async ({ page }) => {
  await openScreening(page);
  await page
    .getByRole('row')
    .filter({ hasText: 'AI0021' })
    .getByRole('button', { name: '查看', exact: true })
    .click();
  await expect(
    page.getByText(`本次使用的企业资料 · ${snapshot.name}`, { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('row')
    .filter({ hasText: 'AI0022' })
    .getByRole('button', { name: '查看', exact: true })
    .click();
  await expect(
    page.getByText('该历史报告未留存企业资料快照，无法还原当时使用的内容。'),
  ).toBeVisible();
  await expect(
    page.getByText(`本次使用的企业资料 · ${snapshot.name}`, { exact: true }),
  ).toHaveCount(0);
});
