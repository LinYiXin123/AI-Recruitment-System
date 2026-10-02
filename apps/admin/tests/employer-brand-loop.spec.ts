import { expect, type Page, test } from '@playwright/test';

const now = '2026-10-03T08:00:00Z';
const enterprise = {
  id: 1,
  name: '资料协作验收企业',
  industry: '医药健康',
  introduction: '研发与生产医药产品。',
  remark: '',
  sort_order: 0,
  enabled: true,
  deleted_at: null as string | null,
  endorsement_count: 2,
  completed_categories: 1,
  updated_at: now,
};
const content = {
  id: 1,
  enterprise_id: 1,
  enterprise_name: enterprise.name,
  enterprise_deleted: false,
  category: 'company_introduction',
  category_label: '公司简介',
  title: '已核实公司简介',
  body: '经负责人核实的企业业务信息。',
  sort_order: 0,
  enabled: true,
  deleted_at: null,
  updated_at: '2026-10-03T09:00:00Z',
};
const baseIssue = {
  id: 1,
  enterprise_id: 1,
  enterprise_name: enterprise.name,
  category: 'company_introduction',
  question: '请核实企业主营业务范围。',
  source_reference: '飞书投递编号 FS-001',
  status: 'pending',
  requester_id: 7,
  requester_name: '验收 HR',
  assignee_id: 7,
  assignee_name: '验收 HR',
  answer: '',
  answered_at: null as string | null,
  follow_up_note: '',
  closed_at: null as string | null,
  version: 1,
  created_at: now,
  updated_at: now,
  endorsement_id: null as number | null,
  endorsement_snapshot: null as null | typeof content,
};

async function openLoop(page: Page, query = '', withHistory = false, deletedOnly = false) {
  const state = {
    issues: withHistory
      ? [
          { ...baseIssue },
          {
            ...baseIssue,
            id: 2,
            enterprise_id: 3,
            enterprise_name: '已删除历史企业',
            question: '已删除企业的福利问题仍需反馈。',
            status: 'answered',
            assignee_id: 8,
            assignee_name: '资料负责人',
            answer: '已核实旧版福利说明。',
            answered_at: now,
          },
        ]
      : ([] as (typeof baseIssue)[]),
    jobs: [
      {
        id: 11,
        title: '招聘专员',
        company_name: deletedOnly ? '已删除历史企业' : '原职位公司',
        enterprise_id: deletedOnly ? 3 : (null as number | null),
        enterprise_name: deletedOnly ? '已删除历史企业' : '',
        enterprise_enabled: false,
        enterprise_deleted: deletedOnly,
        version: 1,
        can_edit: true,
      },
    ],
    assignees: [
      { id: 7, name: '验收 HR' },
      { id: 8, name: '资料负责人' },
    ],
    requests: [] as { path: string; body: Record<string, unknown> }[],
    loads: 0,
    failCreate: false,
    holdSave: false,
    conflictJob: false,
    finishSave: null as (() => Promise<void>) | null,
  };
  // 所有 API 均模拟，不使用真实招聘资料，也不向实际业务接口写入。
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/csrf/')) return route.fulfill({ json: { csrfToken: 'mock' } });
    if (path.endsWith('/me/'))
      return route.fulfill({
        json: {
          name: '验收 HR',
          avatar_url: '',
          auth_source: 'local',
          organization: '验收组织',
          roles: ['hr'],
          departments: [],
        },
      });
    if (path === '/api/v1/employer-brand/')
      return route.fulfill({
        json: {
          enterprise_limit: 20,
          enterprises: deletedOnly ? [] : [enterprise],
          deleted_enterprises: [{ ...enterprise, id: 3, name: '已删除历史企业', deleted_at: now }],
          endorsements: deletedOnly
            ? []
            : [
                content,
                {
                  ...content,
                  id: 2,
                  title: '尚未核实的旧简介',
                  updated_at: '2026-10-01T00:00:00Z',
                },
              ],
          deleted_endorsements: [],
        },
      });
    if (path.endsWith('/coordination/')) {
      state.loads++;
      return route.fulfill({
        json: {
          current_member_id: 7,
          jobs: state.jobs,
          assignees: state.assignees,
          issues: state.issues,
        },
      });
    }
    const body = route.request().postDataJSON();
    state.requests.push({ path, body });
    const finish = async () => {
      if (path.endsWith('/issues/')) {
        if (state.failCreate)
          return route.fulfill({ status: 503, json: { errors: { detail: '记录失败，请重试。' } } });
        const issue = {
          ...baseIssue,
          id: 20,
          ...body,
          source_reference: String(body.source_reference),
          assignee_name: state.assignees.find((item) => item.id === body.assignee_id)!.name,
        };
        state.issues.push(issue);
        return route.fulfill({ json: issue });
      }
      if (path.endsWith('/job-enterprise/')) {
        if (state.conflictJob) {
          state.conflictJob = false;
          state.jobs[0].version++;
          return route.fulfill({
            status: 409,
            json: { errors: { detail: '职位已被其他人修改，请刷新后重试。' } },
          });
        }
        Object.assign(state.jobs[0], {
          enterprise_id: body.enterprise_id,
          enterprise_name: body.enterprise_id ? enterprise.name : '',
          enterprise_enabled: !!body.enterprise_id,
          enterprise_deleted: false,
          version: Number(body.version) + 1,
          company_name: body.enterprise_id ? enterprise.name : state.jobs[0].company_name,
        });
        return route.fulfill({ json: state.jobs[0] });
      }
      const match = path.match(/\/issues\/(\d+)\/(answer|close|reassign)\/$/);
      if (match) {
        const issue = state.issues.find((item) => item.id === Number(match[1]))!;
        if (match[2] === 'answer')
          Object.assign(issue, body, {
            status: 'answered',
            answered_at: now,
            endorsement_snapshot: body.endorsement_id ? { ...content } : null,
          });
        if (match[2] === 'close') Object.assign(issue, body, { status: 'closed', closed_at: now });
        if (match[2] === 'reassign')
          Object.assign(issue, body, {
            assignee_name: state.assignees.find((item) => item.id === body.assignee_id)!.name,
          });
        issue.version = Number(body.version) + 1;
        return route.fulfill({ json: issue });
      }
      return route.fulfill({ status: 501, json: { errors: { detail: `未模拟接口：${path}` } } });
    };
    if (state.holdSave) state.finishSave = finish;
    else await finish();
  });
  await page.goto(
    `${process.env.EMPLOYER_BRAND_TEST_URL || 'http://localhost:5174'}/#employer-brand${query}`,
  );
  await expect(page.locator('.enterprise-coordination')).toContainText('资料问题');
  return state;
}

test('AI 来源带入问题草稿，失败重试保留标识，答复与实际反馈完成闭环', async ({
  page,
}, testInfo) => {
  const state = await openLoop(page, '?enterprise=1&source=AI%20初面报告%20AI-001');
  await expect(page.getByRole('heading', { name: enterprise.name, exact: true })).toBeVisible();
  await page.getByRole('button', { name: '记录资料问题', exact: true }).click();
  const dialog = page.locator('dialog.enterprise-coordination-dialog');
  await expect(dialog.getByLabel('人工来源记录（选填）')).toHaveValue('AI 初面报告 AI-001');
  await dialog.getByLabel('需要核实的问题 *').fill('请确认主营业务是否包含制剂研发。');
  await dialog.getByRole('combobox', { name: '负责人 *', exact: true }).click();
  await page.getByRole('option', { name: /验收 HR$/ }).click();
  await expect(dialog.getByRole('combobox', { name: '负责人 *', exact: true })).toContainText(
    '验收 HR',
  );
  page.once('dialog', (confirm) => confirm.dismiss());
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(dialog).toBeVisible();
  state.failCreate = true;
  await dialog.getByRole('button', { name: '记录问题', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('记录失败');
  await expect(dialog.getByLabel('需要核实的问题 *')).toHaveValue(
    '请确认主营业务是否包含制剂研发。',
  );
  const requestKey = state.requests.at(-1)!.body.request_key;
  expect(requestKey).toMatch(/^[\da-f-]{36}$/);
  state.failCreate = false;
  state.holdSave = true;
  await dialog.getByRole('button', { name: '记录问题', exact: true }).click();
  await expect.poll(() => state.finishSave).not.toBeNull();
  await expect(dialog.getByLabel('需要核实的问题 *')).toBeDisabled();
  await expect(dialog.getByRole('button', { name: '关闭', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await state.finishSave!();
  state.holdSave = false;
  await expect(dialog).toHaveCount(0);
  expect(state.requests.at(-1)!.body.request_key).toBe(requestKey);
  const card = page
    .locator('.enterprise-issue-card')
    .filter({ hasText: '请确认主营业务是否包含制剂研发。' });
  await expect(card).toContainText('待核实');
  await expect(card).toContainText('人工记录来源：AI 初面报告 AI-001');
  await card.getByRole('button', { name: '核实并答复' }).click();
  await dialog.getByLabel('核实答复 *').fill('已核实，主营业务包括制剂研发，资料已更新。');
  await dialog.getByRole('combobox', { name: '关联已更新的背书内容（选填）' }).click();
  await expect(page.getByRole('option', { name: /尚未核实的旧简介$/ })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await page.getByRole('option', { name: /已核实公司简介$/ }).click();
  await expect(
    dialog.getByRole('combobox', { name: '关联已更新的背书内容（选填）' }),
  ).toContainText('已核实公司简介');
  await dialog.getByRole('button', { name: '保存答复', exact: true }).click();
  await expect(card).toContainText('已答复待反馈');
  await card.locator('summary').click();
  await expect(card).toContainText(content.body);
  expect(state.requests.at(-1)!.body).toEqual({
    version: 1,
    answer: '已核实，主营业务包括制剂研发，资料已更新。',
    endorsement_id: 1,
  });
  await card.getByRole('button', { name: '记录反馈结果', exact: true }).click();
  await dialog
    .getByLabel('实际反馈结果 *')
    .fill('已在飞书向提问同事反馈核实结果，对方确认无补充问题。');
  await dialog.getByRole('button', { name: '保存反馈结果', exact: true }).click();
  await expect(card).toContainText('已反馈');
  await expect(card).toContainText('对方确认无补充问题');
  expect(state.requests.some((item) => item.path.includes('/endorsements/'))).toBe(false);
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('资料问题-答复与反馈.png') });
});

test('列表可发现参与问题和删除企业历史，负责人更换及手动刷新生效', async ({ page }) => {
  const state = await openLoop(page, '', true);
  await expect(page.locator('.enterprise-issue-card')).toHaveCount(2);
  await page.getByRole('button', { name: '待我反馈 1', exact: true }).click();
  const historical = page.locator('.enterprise-issue-card');
  await expect(historical).toHaveCount(1);
  await expect(historical).toContainText('已删除历史企业（已删除企业）');
  await expect(historical.getByRole('button', { name: '查看企业资料' })).toHaveCount(0);
  await expect(historical.getByRole('button', { name: '记录反馈结果' })).toBeEnabled();
  await page.getByRole('button', { name: '待我核实 1', exact: true }).click();
  const current = page.locator('.enterprise-issue-card');
  await current.getByRole('button', { name: '更换负责人' }).click();
  const dialog = page.locator('dialog.enterprise-coordination-dialog');
  await dialog.getByRole('combobox', { name: '负责人 *', exact: true }).click();
  await page.getByRole('option', { name: /资料负责人$/ }).click();
  await expect(dialog.getByRole('combobox', { name: '负责人 *', exact: true })).toContainText(
    '资料负责人',
  );
  await dialog.getByRole('button', { name: '保存负责人' }).click();
  await expect(page.getByRole('button', { name: '待我核实 0', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '全部问题 2', exact: true }).click();
  const pending = page.locator('.enterprise-issue-card').filter({ hasText: baseIssue.question });
  await expect(pending).toContainText('等待负责人核实');
  await expect(pending.getByRole('button', { name: '核实并答复' })).toHaveCount(0);
  state.issues[0].status = 'answered';
  state.issues[0].answer = '另一位负责人已经完成核实。';
  state.issues[0].answered_at = now;
  const loads = state.loads;
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect.poll(() => state.loads).toBeGreaterThan(loads);
  await expect(pending).toContainText('另一位负责人已经完成核实');
  await expect(page.getByRole('button', { name: '待我反馈 2', exact: true })).toBeVisible();
});

test('职位关联冲突保留草稿并更新版本，窄屏可绑定和解除', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await openLoop(page, '?enterprise=1');
  await page
    .locator('.enterprise-coordination-panel > summary')
    .filter({ hasText: '关联职位' })
    .click();
  await page.getByRole('button', { name: '关联职位', exact: true }).click();
  const dialog = page.locator('dialog.enterprise-coordination-dialog');
  await dialog.getByRole('combobox', { name: '职位 *', exact: true }).click();
  await page.getByRole('option', { name: /招聘专员 · 原职位公司$/ }).click();
  await expect(dialog.getByRole('combobox', { name: '职位 *', exact: true })).toContainText(
    '招聘专员',
  );
  state.conflictJob = true;
  await dialog.getByRole('button', { name: '保存关联' }).click();
  await expect(dialog.getByRole('alert')).toContainText('职位已被其他人修改');
  await expect(dialog.getByRole('button', { name: '保存关联' })).toBeDisabled();
  await dialog.getByRole('button', { name: '刷新状态并保留草稿' }).click();
  await expect(dialog.getByRole('status')).toContainText('已读取最新状态并保留草稿');
  await expect(dialog.getByRole('combobox', { name: '所属企业', exact: true })).toContainText(
    enterprise.name,
  );
  await expect(dialog.getByRole('button', { name: '保存关联' })).toBeEnabled();
  const box = await dialog.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(box!.y + box!.height).toBeLessThanOrEqual(844);
  await page.screenshot({ path: testInfo.outputPath('关联职位-手机草稿.png') });
  await dialog.getByRole('button', { name: '保存关联' }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.requests.at(-1)!.body).toEqual({ job_id: 11, enterprise_id: 1, version: 2 });
  await expect(page.locator('.enterprise-related-job')).toContainText('招聘专员');
  await page.getByRole('button', { name: '更改关联' }).click();
  await dialog.getByRole('combobox', { name: '所属企业', exact: true }).click();
  await page.getByRole('option', { name: /不关联企业$/ }).click();
  await expect(dialog.getByRole('combobox', { name: '所属企业', exact: true })).toContainText(
    '不关联企业',
  );
  await dialog.getByRole('button', { name: '保存关联' }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.requests.at(-1)!.body).toEqual({ job_id: 11, enterprise_id: null, version: 3 });
  await expect(page.locator('.enterprise-related-job')).toHaveCount(0);
  expect(state.jobs[0].company_name).toBe(enterprise.name);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.setViewportSize({ width: 390, height: 640 });
  await page.getByRole('button', { name: '记录资料问题', exact: true }).click();
  const body = dialog.locator('.enterprise-dialog-body');
  await expect(dialog.getByLabel('需要核实的问题 *')).toBeVisible();
  await expect(dialog.getByRole('button', { name: '记录问题', exact: true })).toBeInViewport();
  expect(await body.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await dialog.getByRole('combobox', { name: '负责人 *', exact: true }).scrollIntoViewIfNeeded();
  await expect(dialog.getByRole('combobox', { name: '负责人 *', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath('资料问题-手机表单.png') });
});

test('唯一企业被删除后可在列表直接解除职位关联，无需新建企业', async ({ page }) => {
  const state = await openLoop(page, '', false, true);
  await expect(page.locator('.enterprise-card')).toHaveCount(0);
  await page
    .locator('.enterprise-coordination-panel > summary')
    .filter({ hasText: '需处理的职位关联' })
    .click();
  await expect(page.locator('.enterprise-related-job')).toContainText('已删除历史企业');
  await page.getByRole('button', { name: '更改关联' }).click();
  const dialog = page.locator('dialog.enterprise-coordination-dialog');
  await expect(dialog).toContainText('当前关联：已删除历史企业（企业已删除）');
  await expect(dialog.getByRole('combobox', { name: '所属企业', exact: true })).toContainText(
    '不关联企业',
  );
  await dialog.getByRole('button', { name: '保存关联' }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.requests.at(-1)!.body).toEqual({ job_id: 11, enterprise_id: null, version: 1 });
  await expect(page.locator('.enterprise-related-job')).toHaveCount(0);
  await expect(page.locator('.enterprise-coordination')).not.toContainText('需处理的职位关联');
  expect(state.jobs[0].company_name).toBe('已删除历史企业');
});
