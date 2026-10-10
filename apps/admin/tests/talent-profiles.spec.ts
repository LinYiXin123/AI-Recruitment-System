import { expect, type Page, test } from '@playwright/test';
import { api, type Job, type Me } from '../src/lib/api';
import { login } from './helpers';

test('读取响应时取消仍抛取消错误，损坏的成功响应不会当成空数据', async () => {
  const originalFetch = globalThis.fetch;
  try {
    const aborted = new DOMException('请求已取消', 'AbortError');
    const response = new Response('{}');
    response.json = () => Promise.reject(aborted);
    globalThis.fetch = async () => response;
    await expect(api('jobs/')).rejects.toBe(aborted);

    globalThis.fetch = async () => new Response('损坏的响应', { status: 200 });
    await expect(api('jobs/')).rejects.toMatchObject({
      status: 200,
      message: '服务返回内容无法读取，请重试。已填写的内容会保留。',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

async function post(page: Page, path: string, data: unknown): Promise<Job> {
  const csrf = await (await page.request.get('/api/v1/auth/csrf/')).json();
  const response = await page.request.post(`/api/v1/${path}`, {
    data,
    headers: { 'X-CSRFToken': csrf.csrfToken },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

async function createJob(page: Page, title: string, extra: Record<string, unknown> = {}) {
  const me: Me = await (await page.request.get('/api/v1/me/')).json();
  return post(page, 'jobs/', {
    request_id: crypto.randomUUID(),
    title,
    department: me.departments[0].id,
    approver: me.departments[0].approvers[0].id,
    location: '深圳',
    headcount: 1,
    jd: '负责区域渠道拓展，独立寻找合作伙伴并复盘项目结果。',
    ...extra,
  });
}

async function readJob(page: Page, id: number): Promise<Job> {
  const response = await page.request.get(`/api/v1/jobs/${id}/`);
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

async function openProfile(page: Page, title: string) {
  await page.goto('/#talent-profiles');
  await expect(page.getByRole('heading', { name: '人才画像', exact: true })).toBeVisible();
  await page
    .getByRole('row')
    .filter({ hasText: title })
    .getByRole('button', { name: title, exact: true })
    .click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
}

test('岗位画像表单可查询和重置，新建入口打开画像起草流程', async ({ page }) => {
  await login(page);
  await page.route('**/api/v1/jobs/?*', (route) =>
    route.fulfill({ json: { count: 0, next: null, previous: null, results: [] } }),
  );
  let jobPosts = 0;
  let modelPosts = 0;
  page.on('request', (request) => {
    if (request.method() !== 'POST') return;
    if (new URL(request.url()).pathname === '/api/v1/jobs/') jobPosts++;
    if (new URL(request.url()).pathname === '/api/v1/jobs/profile-ai/') modelPosts++;
  });
  await page.goto('/#talent-profiles');
  await expect(page.locator('.candidate-library-empty-icon svg')).toBeVisible();
  await expect(page.getByLabel('目标职位', { exact: true })).toBeVisible();
  await expect(page.getByLabel('城市', { exact: true })).toBeVisible();
  const startDraft = page.getByRole('button', { name: '新建画像', exact: true });
  await expect(startDraft).toBeVisible();
  await expect(
    page.getByRole('region', { name: '岗位画像工作台' }).getByRole('button', { name: /起草/ }),
  ).toHaveCount(0);
  await page.getByLabel('目标职位', { exact: true }).fill('不存在的职位');
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page.getByText('没有符合条件的职位', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '重置', exact: true }).click();
  await expect(page.getByLabel('目标职位', { exact: true })).toHaveValue('');
  await expect(page.getByText('还没有岗位画像', { exact: true })).toBeVisible();
  await page.screenshot({ path: '../../.local/人才画像-统一页面布局.png', fullPage: true });
  const draft = page.getByRole('dialog', { name: 'AI 起草招人要求' });
  let prompts = 0;
  let discard = false;
  page.on('dialog', async (dialog) => {
    prompts++;
    expect(dialog.message()).toBe('招人要求还没保存，确定关闭吗？');
    if (discard) await dialog.accept();
    else await dialog.dismiss();
  });
  await startDraft.click();
  await expect(draft.getByLabel('你想招什么样的人？')).toBeVisible();
  await expect(draft.getByLabel('职位名称', { exact: true })).toHaveCount(0);
  await expect(draft.getByLabel('所属部门', { exact: true })).toHaveCount(0);
  await expect(draft.getByRole('button', { name: 'AI 生成画像', exact: true })).toBeDisabled();
  await draft.getByRole('button', { name: '关闭详情', exact: true }).click();
  await expect(draft).toHaveCount(0);
  expect(prompts).toBe(0);
  await startDraft.click();
  await draft.getByLabel('你想招什么样的人？').fill('招聘渠道经理，负责试点和项目复盘。');
  await draft.getByRole('button', { name: '取消', exact: true }).click();
  await expect(draft.getByLabel('你想招什么样的人？')).toHaveValue(
    '招聘渠道经理，负责试点和项目复盘。',
  );
  expect(prompts).toBe(1);
  discard = true;
  await draft.getByRole('button', { name: '关闭详情', exact: true }).click();
  await expect(draft).toHaveCount(0);
  expect(prompts).toBe(2);
  expect(jobPosts).toBe(0);
  expect(modelPosts).toBe(0);
});

test('岗位列表展示生效画像字段，按职位和城市查询并可直接去匹配', async ({ page }) => {
  await login(page);
  const job = await createJob(page, 'AI 应用工程师（画像字段验收）', {
    location: '深圳南山',
    salary_range: '18-25K',
    profile: {
      source: 'HR 核对',
      activate: true,
      requirements: [
        {
          category: 'education',
          kind: 'must',
          text: '本科及以上学历',
          needs_verification: false,
        },
        {
          category: 'experience',
          kind: 'must',
          text: '3 年以上相关工作经验',
          needs_verification: false,
        },
        { category: 'skill', kind: 'must', text: 'LangGraph', needs_verification: false },
      ],
    },
  });
  await createJob(page, 'AI 应用工程师（其他城市验收）', { location: '厦门' });
  await createJob(page, '后端工程师（同城市验收）', { location: '深圳' });

  await page.goto('/#talent-profiles');
  for (const column of [
    '目标职位',
    '城市',
    '学历 / 年限',
    '必备技能',
    '薪资范围',
    '更新时间',
    '操作',
  ]) {
    await expect(page.getByRole('columnheader', { name: column, exact: true })).toBeVisible();
  }
  const row = page.getByRole('row').filter({ hasText: job.title });
  await expect(row).toContainText('深圳南山');
  await expect(row).toContainText('本科及以上 · 3 年以上');
  await expect(row).toContainText('18-25K');
  await expect(row).toContainText(/20\d{2}/);
  await expect(row).not.toContainText('已生效 v1');
  await expect(row.getByTitle('LangGraph')).toBeVisible();
  await expect(row.getByRole('button', { name: '去匹配', exact: true })).toBeVisible();
  await expect(row.getByRole('button', { name: '编辑', exact: true })).toBeVisible();

  let jdRequest: Record<string, unknown> | undefined;
  await page.route(`**/api/v1/jobs/${job.id}/job-description-ai/`, async (route) => {
    jdRequest = route.request().postDataJSON();
    await route.fulfill({
      json: { id: 901, status: 'succeeded', error: '', jd: '整理后的职位描述。' },
    });
  });
  await row.getByRole('button', { name: '编辑', exact: true }).click();
  const editor = page.getByRole('dialog');
  await expect(editor.getByRole('heading', { name: '编辑画像', exact: true })).toBeVisible();
  const editorBounds = await editor.boundingBox();
  const viewport = page.viewportSize();
  if (!editorBounds || !viewport) throw new Error('无法读取画像弹窗位置。');
  expect(Math.abs(editorBounds.x + editorBounds.width / 2 - viewport.width / 2)).toBeLessThan(2);
  await expect(editor.getByLabel('目标职位', { exact: true })).toHaveValue(job.title);
  await expect(editor.getByLabel('目标职位', { exact: true })).toHaveAttribute('readonly', '');
  for (const label of [
    '招聘需求',
    '工作城市',
    '学历门槛',
    '年限下限',
    '年限上限',
    '薪资范围',
    '行业背景',
    '必备技能',
    '加分技能',
    '其它要求',
  ]) {
    await expect(editor.getByLabel(label, { exact: true })).toBeVisible();
  }
  await expect(editor.getByRole('button', { name: '最近 AI 草稿', exact: true })).toHaveCount(0);
  await expect(editor.getByText('逐条核对原文依据与待核实项', { exact: true })).toHaveCount(0);
  await expect(editor.getByRole('button', { name: 'AI 生成 JD', exact: true })).toBeVisible();
  await expect(editor.getByRole('button', { name: 'AI 生成画像', exact: true })).toBeVisible();
  await expect(editor.getByLabel('工作城市', { exact: true })).toHaveValue('深圳南山');
  await expect(editor.getByLabel('薪资范围', { exact: true })).toHaveValue('18-25K');
  await expect(editor.getByRole('combobox', { name: '学历门槛' })).toContainText('本科');
  await expect(editor.getByLabel('年限下限', { exact: true })).toHaveValue('3');
  await expect(editor.getByLabel('必备技能', { exact: true })).toHaveValue('LangGraph');
  await editor.getByRole('button', { name: 'AI 生成 JD', exact: true }).click();
  await expect(editor.getByLabel('招聘需求', { exact: true })).toHaveValue('整理后的职位描述。');
  expect(jdRequest).toMatchObject({ version: job.version, jd: job.jd });
  page.once('dialog', (dialog) => dialog.accept());
  await editor.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '关闭详情', exact: true }).click();

  await page.getByLabel('目标职位', { exact: true }).fill('AI 应用工程师');
  await page.getByLabel('城市', { exact: true }).fill('南山');
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: job.title })).toBeVisible();
  await expect(page.getByRole('row')).toHaveCount(2);
  await page
    .getByRole('row')
    .filter({ hasText: job.title })
    .getByRole('button', { name: '去匹配' })
    .click();
  await expect(page.getByRole('tab', { name: '简历对照', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('combobox', { name: '目标职位', exact: true })).toContainText(
    job.title,
  );
});

test('AI 优先先生成再补职位信息，最终保存才建岗，失败保留内容并以同一请求重试', async ({
  page,
}) => {
  await login(page);
  const before = await (await page.request.get('/api/v1/jobs/')).json();
  const me: Me = await (await page.request.get('/api/v1/me/')).json();
  const jd = '招聘渠道经理，负责独立寻找合作伙伴并复盘项目结果。';
  const goal = '首季度完成渠道试点，形成可复用记录。';
  const generationRequests: Record<string, unknown>[] = [];
  const saveRequests: Record<string, unknown>[] = [];
  const requirements = [
    {
      kind: 'must' as const,
      text: '能够独立寻找合作伙伴并复盘项目结果',
      rationale: '通过本人负责的项目核对渠道经验。',
      needs_verification: true,
      source_kind: 'jd',
      source_quote: '独立寻找合作伙伴并复盘项目结果',
      source_reference: 'jd',
      generation_index: 0,
    },
  ];
  // 只模拟模型和最终保存响应；原子建岗及重试不重复入库由后端业务测试验证。
  await page.route('**/api/v1/jobs/profile-ai/', async (route) => {
    if (route.request().method() !== 'POST') return route.fulfill({ json: { items: [] } });
    const input = route.request().postDataJSON();
    generationRequests.push(input);
    if (generationRequests.length === 1)
      return route.fulfill({
        status: 503,
        json: { errors: { detail: '生成暂时失败，请重试。' } },
      });
    return route.fulfill({
      json: {
        id: 90301,
        status: 'succeeded',
        error: '',
        input: { jd: input.jd, business_goal: input.business_goal },
        requirements,
        created_at: '2026-10-03T03:00:00Z',
        job_version: null,
      },
    });
  });
  let created: Job;
  await page.route('**/api/v1/jobs/', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const input = route.request().postDataJSON();
    saveRequests.push(input);
    if (saveRequests.length === 1)
      return route.fulfill({
        status: 503,
        json: { errors: { detail: '保存暂时失败，请重试。' } },
      });
    created = {
      id: 90302,
      active_profile: 90303,
      active_profile_number: 1,
      title: input.title,
      department: input.department,
      department_name: me.departments[0].name,
      company_name: '',
      job_level: '',
      salary_range: input.salary_range,
      base_salary: '',
      performance_salary: '',
      commission_salary: '',
      total_monthly_salary: '',
      planned_publish_date: null,
      location: input.location,
      headcount: input.headcount,
      owner_name: me.name,
      owner_avatar_url: '',
      owner_chat_url: '',
      approver_name: me.departments[0].approvers[0].name,
      status: 'draft',
      jd: input.jd,
      version: 1,
      updated_at: '2026-10-03T03:00:00Z',
      permissions: { edit: true, confirm: false },
      latest_profile: {
        id: 90303,
        number: 1,
        jd_snapshot: input.jd,
        source: input.profile.source,
        business_goal: input.profile.business_goal,
        status: 'confirmed',
        requirements: (
          input.profile.requirements as NonNullable<Job['latest_profile']>['requirements']
        ).map((item, index) => ({ ...item, id: index + 1 })),
        created_at: '2026-10-03T03:00:00Z',
        created_by_name: me.name,
        confirmed_by_name: me.name,
        confirmed_at: '2026-10-03T03:00:00Z',
        review_note: '',
      },
    };
    return route.fulfill({ status: 201, json: created });
  });
  await page.route('**/api/v1/jobs/90302/', (route) => route.fulfill({ json: created }));
  await page.goto('/#talent-profiles');
  await page.getByRole('button', { name: '新建画像', exact: true }).click();
  const draft = page.getByRole('dialog', { name: 'AI 起草招人要求' });
  await expect(draft.getByLabel('你想招什么样的人？')).toBeVisible();
  await page.screenshot({ path: '../../.local/人才画像-AI先起草.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(draft.getByLabel('职位名称', { exact: true })).toHaveCount(0);
  await draft.getByLabel('你想招什么样的人？').fill(jd);
  await draft.getByText('补充入职目标（可选）', { exact: true }).click();
  await draft.getByLabel('希望入职后完成什么？').fill(goal);
  await draft.getByRole('button', { name: 'AI 生成画像', exact: true }).click();
  await expect(draft.getByRole('alert')).toContainText('生成暂时失败');
  await expect(draft.getByRole('button', { name: '手动整理要求', exact: true })).toBeEnabled();
  await expect(draft.getByLabel('你想招什么样的人？')).toHaveValue(jd);
  await expect(draft.getByLabel('希望入职后完成什么？')).toHaveValue(goal);
  expect(saveRequests).toHaveLength(0);
  await draft.getByRole('button', { name: 'AI 生成画像', exact: true }).click();
  await expect(draft.getByRole('button', { name: '采用这份草稿', exact: true })).toBeEnabled();
  expect(generationRequests).toHaveLength(2);
  expect(generationRequests[0]).toMatchObject({ jd, business_goal: goal });
  expect(generationRequests[1]).toEqual(generationRequests[0]);
  expect(generationRequests[1]).not.toHaveProperty('version');
  expect(saveRequests).toHaveLength(0);
  expect((await (await page.request.get('/api/v1/jobs/')).json()).count).toBe(before.count);
  await draft.getByRole('button', { name: '采用这份草稿', exact: true }).click();
  await draft.getByLabel('具体要求 1', { exact: true }).fill('能用本人项目说明渠道拓展及复盘结果');
  await expect(draft.getByLabel('要求 1 类型', { exact: true })).toContainText('必须满足');
  await expect(draft.getByText(`原始依据：${requirements[0].source_quote}`)).toBeVisible();
  await draft.getByRole('button', { name: '添加一项要求', exact: true }).click();
  await draft.getByLabel('具体要求 2', { exact: true }).fill('可补充项目复盘样例');
  await draft.getByRole('button', { name: '删除要求 2', exact: true }).click();
  await expect(draft.getByLabel('具体要求 2', { exact: true })).toHaveCount(0);
  expect(saveRequests).toHaveLength(0);
  await draft.getByRole('button', { name: '继续：补充职位信息', exact: true }).click();
  await expect(draft.getByRole('button', { name: '保存并使用', exact: true })).toBeDisabled();
  await draft.getByRole('button', { name: '上一步', exact: true }).click();
  await expect(draft.getByLabel('具体要求 1', { exact: true })).toHaveValue(
    '能用本人项目说明渠道拓展及复盘结果',
  );
  await draft.getByRole('checkbox', { name: '这条招人要求还没确定' }).uncheck();
  await draft.getByRole('button', { name: '继续：补充职位信息', exact: true }).click();
  await draft.getByLabel('职位名称', { exact: true }).fill('渠道经理（AI 优先虚构验收）');
  await draft.getByLabel('工作地点', { exact: true }).fill('深圳');
  await draft.getByLabel('薪资范围', { exact: true }).fill('20-35K，13 薪');
  await draft.getByLabel('用人负责人（用于澄清）', { exact: true }).click();
  await page.getByRole('option', { name: new RegExp(me.departments[0].approvers[0].name) }).click();
  await expect(draft.getByLabel('用人负责人（用于澄清）', { exact: true })).toContainText(
    me.departments[0].approvers[0].name,
  );
  expect(saveRequests).toHaveLength(0);
  expect((await (await page.request.get('/api/v1/jobs/')).json()).count).toBe(before.count);
  const bounds = await draft.boundingBox();
  if (!bounds) throw new Error('AI 起草弹层不可见');
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(391);
  await expect(draft.getByRole('button', { name: '保存并使用', exact: true })).toBeInViewport();
  await page.screenshot({ path: '../../.local/人才画像-AI优先390.png' });
  await draft.getByRole('button', { name: '保存并使用', exact: true }).click();
  await expect(draft.getByRole('alert')).toContainText('保存暂时失败');
  await expect(draft.getByLabel('职位名称', { exact: true })).toHaveValue(
    '渠道经理（AI 优先虚构验收）',
  );
  expect(saveRequests[0]).toMatchObject({
    title: '渠道经理（AI 优先虚构验收）',
    jd,
    location: '深圳',
    salary_range: '20-35K，13 薪',
    headcount: 1,
    profile: {
      generation_id: 90301,
      business_goal: goal,
      activate: true,
      requirements: [
        {
          generation_index: 0,
          text: '能用本人项目说明渠道拓展及复盘结果',
          needs_verification: false,
          source_quote: requirements[0].source_quote,
        },
      ],
    },
  });
  expect(saveRequests[0].request_id).toMatch(/^[0-9a-f-]{36}$/i);
  await draft.getByRole('button', { name: '保存并使用', exact: true }).click();
  await expect(draft).toHaveCount(0);
  expect(saveRequests).toHaveLength(2);
  expect(saveRequests[1]).toEqual(saveRequests[0]);
  await expect(
    page.getByRole('heading', { name: '渠道经理（AI 优先虚构验收）', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('能用本人项目说明渠道拓展及复盘结果', { exact: true })).toBeVisible();
});

test('编辑画像按参考字段自动提取，待确认项不生效且失败时保留内容', async ({ page }) => {
  await login(page);
  const job = await createJob(page, '渠道经理（AI 画像虚构验收）', {
    location: '深圳',
    salary_range: '18-25K',
  });
  let modelPosts = 0;
  await page.route(`**/api/v1/jobs/${job.id}/profile-ai/`, async (route) => {
    modelPosts++;
    const input = route.request().postDataJSON();
    expect(input).toMatchObject({
      version: job.version,
      jd: job.jd,
      business_goal: '',
    });
    expect(input.request_key).toMatch(/^[0-9a-f-]{36}$/i);
    return route.fulfill({
      json: {
        id: 90211,
        status: 'succeeded',
        error: '',
        input: { jd: input.jd, business_goal: input.business_goal },
        job_version: job.version,
        requirements: [
          {
            kind: 'must',
            category: 'skill',
            text: 'Python、LangGraph',
            rationale: '结合项目核对技术应用。',
            needs_verification: false,
            source_kind: 'jd',
            source_quote: '熟悉 Python 和 LangGraph',
            source_reference: 'jd',
            generation_index: 0,
          },
          {
            kind: 'preferred',
            category: 'skill',
            text: 'RAG',
            rationale: 'AI 建议，需由 HR 核对。',
            needs_verification: true,
            source_kind: 'ai_suggestion',
            source_quote: '',
            source_reference: '',
            generation_index: 1,
          },
          {
            kind: 'must',
            category: 'other',
            text: '有真实项目经验',
            rationale: '需确认是否属于必须条件。',
            needs_verification: true,
            source_kind: 'jd',
            source_quote: '具备真实项目经验',
            source_reference: 'jd',
            generation_index: 2,
          },
        ],
      },
    });
  });
  await page.goto('/#talent-profiles');
  await expect(page.getByLabel('目标职位', { exact: true })).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: job.title });
  await row.getByRole('button', { name: '完善画像', exact: true }).click();
  const editor = page.getByRole('dialog');
  await expect(editor.getByLabel('招聘需求', { exact: true })).toHaveValue(job.jd);
  await expect(editor.getByLabel('工作城市', { exact: true })).toHaveValue('深圳');
  await expect(editor.getByLabel('薪资范围', { exact: true })).toHaveValue('18-25K');
  await expect(editor.getByText('已填 2 项', { exact: true })).toBeVisible();
  await expect(
    editor.getByText('「AI 生成画像」会把招聘需求提炼成下方字段，核对修改后保存即可', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(editor.getByRole('button', { name: '最近 AI 草稿', exact: true })).toHaveCount(0);
  expect(modelPosts).toBe(0);
  await editor.getByRole('button', { name: 'AI 生成画像', exact: true }).click();
  await expect(editor.getByLabel('必备技能', { exact: true })).toHaveValue('Python、LangGraph');
  await expect(editor.getByLabel('加分技能', { exact: true })).toHaveValue('RAG');
  await expect(editor.getByLabel('其它要求', { exact: true })).toHaveValue('有真实项目经验');
  await expect(editor.getByText('已填 5 项', { exact: true })).toBeVisible();
  const education = editor.getByRole('combobox', { name: '学历门槛' });
  await education.click();
  await page.getByRole('option', { name: /本科$/ }).click();
  await expect(editor.getByText('已填 6 项', { exact: true })).toBeVisible();
  await expect(education).toContainText('本科');
  await editor.getByText('确认 1 项必备要求', { exact: true }).click();
  await expect(
    editor.getByRole('checkbox', { name: '确认该必备要求：有真实项目经验' }),
  ).toBeVisible();
  await expect(editor.getByRole('button', { name: '采用这份草稿', exact: true })).toHaveCount(0);
  expect((await readJob(page, job.id)).latest_profile).toBeNull();
  expect((await readJob(page, job.id)).active_profile).toBeNull();

  const saves: Record<string, unknown>[] = [];
  await page.route(`**/api/v1/jobs/${job.id}/profiles/`, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    saves.push(route.request().postDataJSON());
    return route.fulfill({
      status: 503,
      json: { errors: { detail: '验收保存暂未完成，请重试。' } },
    });
  });
  const save = editor.getByRole('button', { name: '保存', exact: true });
  await save.click();
  await expect(editor.getByRole('alert')).toContainText('验收保存暂未完成');
  expect(saves[0]).toMatchObject({
    version: job.version,
    activate: false,
    generation_id: 90211,
    business_goal: '',
    location: '深圳',
    salary_range: '18-25K',
    requirements: [
      { generation_index: 0, category: 'skill', text: 'Python、LangGraph' },
      { generation_index: 1, category: 'skill', kind: 'preferred', text: 'RAG' },
      { generation_index: 2, text: '有真实项目经验', needs_verification: true },
      { category: 'education', kind: 'must', text: '本科及以上学历' },
    ],
  });
  const confirmRequirements = editor.locator('details').filter({
    hasText: '确认 1 项必备要求',
  });
  if (!(await confirmRequirements.evaluate((details) => (details as HTMLDetailsElement).open))) {
    await confirmRequirements.locator('summary').click();
  }
  await editor.getByRole('checkbox', { name: '确认该必备要求：有真实项目经验' }).click();
  await save.click();
  await expect(editor.getByRole('alert')).toContainText('验收保存暂未完成');
  expect(saves[1]).toMatchObject({ activate: true, generation_id: 90211 });
  await editor.getByLabel('招聘需求', { exact: true }).fill('需求已修改，需要重新生成画像。');
  await expect(save).toBeDisabled();
  await expect(
    editor.getByText('招聘需求已修改，请重新生成画像后再保存。你填写的内容已保留。', {
      exact: true,
    }),
  ).toBeVisible();
  await editor.getByLabel('招聘需求', { exact: true }).fill(job.jd);
  await expect(save).toBeEnabled();
  expect((await readJob(page, job.id)).active_profile).toBeNull();
});

test('编辑弹窗用简洁字段保留多条必备、加分和排除要求，并可在窄屏保存', async ({ page }) => {
  await login(page);
  let job = await createJob(page, '渠道经理（精简编辑器虚构验收）');
  job = await post(page, `jobs/${job.id}/profiles/`, {
    version: job.version,
    jd: job.jd,
    source: '虚构招聘标准',
    activate: true,
    requirements: Array.from({ length: 15 }, (_, i) => ({
      kind: i < 6 ? 'must' : i === 14 ? 'exclusion' : 'preferred',
      text: `能够说明渠道工作中的第 ${i + 1} 项任务及个人贡献`,
      rationale: '结合本人案例核对职责与结果',
      needs_verification: false,
    })),
  });
  job = await post(page, `jobs/${job.id}/profiles/`, {
    version: job.version,
    jd: job.jd,
    source: '虚构招聘标准草稿',
    requirements: job.latest_profile?.requirements,
  });
  await openProfile(page, job.title);
  await page.getByRole('button', { name: '调整要求', exact: true }).click();
  const editor = page.getByRole('dialog');
  const other = editor.getByLabel('其它要求', { exact: true });
  const previous = await other.inputValue();
  expect(previous).toContain('能够说明渠道工作中的第 1 项任务及个人贡献');
  expect(previous).toContain('加分：能够说明渠道工作中的第 7 项任务及个人贡献');
  expect(previous).toContain('排除：能够说明渠道工作中的第 15 项任务及个人贡献');
  for (const hiddenControl of ['岗位要求摘要', '与生效版本比较', '最近 AI 草稿']) {
    await expect(editor.getByText(hiddenControl, { exact: true })).toHaveCount(0);
  }
  const save = editor.getByRole('button', { name: '保存', exact: true });
  await expect(save).toBeInViewport();
  await other.fill(
    previous.replace('能够说明渠道工作中的第 1 项任务及个人贡献', '可以独立说明渠道试点的本人贡献'),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#job-profile-form').evaluate((form) => {
    form.scrollTop = 0;
  });
  await expect(save).toBeInViewport();
  await page.locator('#job-profile-form').evaluate((form) => {
    form.scrollTop = form.scrollHeight;
  });
  await expect(save).toBeInViewport();
  expect(
    await page
      .locator('#job-profile-form')
      .evaluate((form) => form.scrollWidth <= form.clientWidth + 1),
  ).toBeTruthy();
  await save.click();
  await expect(page.getByRole('status')).toContainText(
    '招人要求已保存并使用，可以继续查看候选人的简历。',
  );
  const stored = await readJob(page, job.id);
  expect(stored.active_profile_number).toBe(3);
  expect(stored.latest_profile?.requirements).toHaveLength(15);
  expect(stored.latest_profile?.requirements[0].text).toBe('可以独立说明渠道试点的本人贡献');
  expect(stored.latest_profile?.requirements[6].kind).toBe('preferred');
  expect(stored.latest_profile?.requirements[14].kind).toBe('exclusion');
});

test('AI 失败保留输入，HR 可直接手工保存并在刷新后看到同一版本', async ({ page }) => {
  await login(page);
  const job = await createJob(page, '渠道经理（失败恢复虚构验收）');
  await openProfile(page, job.title);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'AI 起草招人要求', exact: true })
    .click();
  const editor = page.getByRole('dialog');
  await editor.getByLabel('招聘需求', { exact: true }).fill('负责渠道试点和项目复盘。');
  await editor.getByLabel('其它要求', { exact: true }).fill('能说明本人负责的渠道项目及复盘结果');
  await page.route(`**/api/v1/jobs/${job.id}/profile-ai/`, (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ status: 503, json: { errors: { detail: '模型服务暂不可用，请重试。' } } })
      : route.fallback(),
  );
  await editor.getByRole('button', { name: 'AI 生成画像', exact: true }).click();
  await expect(editor.getByRole('alert')).toContainText('模型服务暂不可用');
  await expect(editor.getByLabel('招聘需求', { exact: true })).toHaveValue(
    '负责渠道试点和项目复盘。',
  );
  await expect(editor.getByLabel('其它要求', { exact: true })).toHaveValue(
    '能说明本人负责的渠道项目及复盘结果',
  );
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('招人要求已保存并使用');
  const active = await readJob(page, job.id);
  expect(active.active_profile).toBe(active.latest_profile?.id);
  expect(active.latest_profile?.status).toBe('confirmed');
  expect(active.latest_profile?.confirmed_by_name).toBe('体验 HR');
  await page.reload();
  await page.getByLabel('目标职位', { exact: true }).fill('失败恢复虚构验收');
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: job.title })).not.toContainText('已生效 v1');
  await page.screenshot({ path: '../../.local/人才画像-岗位列表.png', fullPage: true });
  await openProfile(page, job.title);
  await expect(page.getByRole('heading', { name: /^内部招人要求/ })).toContainText('v1 · 已确认');
  await expect(page.getByText('能说明本人负责的渠道项目及复盘结果', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '使用此版本', exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '../../.local/人才画像-390窄屏.png', fullPage: true });
  expect(
    await page.locator('.sheet-scroll').evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBeTruthy();
  await page.getByRole('button', { name: '关闭详情', exact: true }).click();
  await page.goto('/#jobs');
  await page.getByRole('button', { name: job.title, exact: true }).click();
  await expect(page.getByRole('heading', { name: /^内部招人要求/ })).toContainText('v1 · 已确认');
  await expect(page.getByText('能说明本人负责的渠道项目及复盘结果', { exact: true })).toBeVisible();
  const reloaded = await readJob(page, job.id);
  expect(reloaded.active_profile).toBe(active.active_profile);
  expect(reloaded.latest_profile?.number).toBe(active.latest_profile?.number);
});

for (const oldStatus of ['draft', 'pending'] as const) {
  test(`HR 可直接使用既有 ${oldStatus} 版本，非经办人仅可查看`, async ({ page, browser }) => {
    await login(page);
    let job = await createJob(page, `渠道经理（${oldStatus} 直接使用虚构验收）`);
    job = await post(page, `jobs/${job.id}/profiles/`, {
      version: job.version,
      jd: job.jd,
      source: '虚构验收需求',
      requirements: [{ kind: 'must', text: '能够复盘渠道项目结果', needs_verification: false }],
    });
    if (oldStatus === 'pending') {
      job = await post(page, `jobs/${job.id}/submit-profile/`, { version: job.version });
    }
    expect(job.latest_profile?.status).toBe(oldStatus);
    const readerContext = await browser.newContext();
    try {
      const reader = await readerContext.newPage();
      await login(reader, 'local_manager');
      await openProfile(reader, job.title);
      await expect(reader.getByText('能够复盘渠道项目结果', { exact: true })).toBeVisible();
      for (const name of ['AI 起草招人要求', '调整要求', '使用此版本', '保存并使用']) {
        await expect(reader.getByRole('button', { name, exact: true })).toHaveCount(0);
      }
      const csrf = await (await reader.request.get('/api/v1/auth/csrf/')).json();
      const forbidden = await reader.request.post(`/api/v1/jobs/${job.id}/activate-profile/`, {
        headers: { 'X-CSRFToken': csrf.csrfToken },
        data: { version: job.version },
      });
      expect(forbidden.status()).toBe(403);
      expect((await readJob(page, job.id)).active_profile).toBeNull();
    } finally {
      await readerContext.close();
    }
    await openProfile(page, job.title);
    await page.getByRole('button', { name: '使用此版本', exact: true }).click();
    await expect(page.getByText('此版本已生效，无需另外审批。')).toBeVisible();
    await expect(page.getByRole('button', { name: '使用此版本', exact: true })).toHaveCount(0);
    const active = await readJob(page, job.id);
    expect(active.active_profile).toBe(job.latest_profile?.id);
    expect(active.latest_profile?.confirmed_by_name).toBe('体验 HR');
    await page.reload();
    expect((await readJob(page, job.id)).active_profile).toBe(active.active_profile);
  });
}
