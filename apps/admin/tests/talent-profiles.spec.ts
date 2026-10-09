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

async function createJob(page: Page, title: string) {
  const me: Me = await (await page.request.get('/api/v1/me/')).json();
  return post(page, 'jobs/', {
    request_id: crypto.randomUUID(),
    title,
    department: me.departments[0].id,
    approver: me.departments[0].approvers[0].id,
    location: '深圳',
    headcount: 1,
    jd: '负责区域渠道拓展，独立寻找合作伙伴并复盘项目结果。',
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
    .getByRole('button', { name: '查看要求', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
}

test('起草入口位于列表外的页面标题栏，筛选可重置，关闭时保留未保存输入', async ({ page }) => {
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
  await expect(page.getByLabel('职位状态', { exact: true })).toContainText('全部状态');
  const startDraft = page.locator('.page-heading').getByRole('button', {
    name: 'AI 起草招人要求',
    exact: true,
  });
  await expect(startDraft).toBeVisible();
  await expect(
    page.getByRole('region', { name: '岗位画像工作台' }).getByRole('button', { name: /AI 起草/ }),
  ).toHaveCount(0);
  await page.getByLabel('搜索职位', { exact: true }).fill('不存在的职位');
  await expect(page.getByText('没有符合条件的职位', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '重置', exact: true }).click();
  await expect(page.getByLabel('搜索职位', { exact: true })).toHaveValue('');
  await expect(page.getByText('还没有数据', { exact: true })).toBeVisible();
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
  await expect(draft.getByRole('button', { name: 'AI 生成要求', exact: true })).toBeDisabled();
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
      salary_range: '',
      base_salary: '',
      performance_salary: '',
      commission_salary: '',
      total_monthly_salary: '',
      planned_publish_date: null,
      location: input.location,
      headcount: input.headcount,
      owner_name: me.name,
      owner_avatar_url: '',
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
        requirements: input.profile.requirements,
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
  await page
    .locator('.page-heading')
    .getByRole('button', { name: 'AI 起草招人要求', exact: true })
    .first()
    .click();
  const draft = page.getByRole('dialog', { name: 'AI 起草招人要求' });
  await expect(draft.getByLabel('你想招什么样的人？')).toBeVisible();
  await page.screenshot({ path: '../../.local/人才画像-AI先起草.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(draft.getByLabel('职位名称', { exact: true })).toHaveCount(0);
  await draft.getByLabel('你想招什么样的人？').fill(jd);
  await draft.getByText('补充入职目标（可选）', { exact: true }).click();
  await draft.getByLabel('希望入职后完成什么？').fill(goal);
  await draft.getByRole('button', { name: 'AI 生成要求', exact: true }).click();
  await expect(draft.getByRole('alert')).toContainText('生成暂时失败');
  await expect(draft.getByRole('button', { name: '手动整理要求', exact: true })).toBeEnabled();
  await expect(draft.getByLabel('你想招什么样的人？')).toHaveValue(jd);
  await expect(draft.getByLabel('希望入职后完成什么？')).toHaveValue(goal);
  expect(saveRequests).toHaveLength(0);
  await draft.getByRole('button', { name: 'AI 生成要求', exact: true }).click();
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

test('AI 仅生成可编辑建议，采用不生效，保存请求携带来源与明确使用动作', async ({ page }) => {
  await login(page);
  const job = await createJob(page, '渠道经理（AI 画像虚构验收）');

  // 仅模拟模型返回；真实来源入库、幂等与校验由后端测试验证，不调用真实模型。
  let generated: Record<string, unknown> | null = null;
  let modelPosts = 0;
  await page.route(`**/api/v1/jobs/${job.id}/profile-ai/`, async (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({
        json: {
          items: generated
            ? [{ ...generated, id: 90210, job_version: job.version - 1 }, generated]
            : [],
        },
      });
    modelPosts++;
    const input = route.request().postDataJSON();
    expect(input).toMatchObject({
      version: job.version,
      jd: job.jd,
      business_goal: '首个季度完成渠道试点并形成复盘记录。',
    });
    expect(input.request_key).toMatch(/^[0-9a-f-]{36}$/i);
    generated = {
      id: 90211,
      status: 'succeeded',
      error: '',
      input: { jd: input.jd, business_goal: input.business_goal },
      job_version: job.version,
      is_current: true,
      model: '虚构验收模型',
      prompt_version: 'job-profile-v1',
      created_at: '2026-10-03T02:00:00Z',
      requirements: [
        {
          kind: 'must',
          text: '能够独立开展渠道拓展并复盘项目结果',
          rationale: '需说明本人负责的项目过程及结果口径。',
          needs_verification: false,
          source_kind: 'jd',
          source_quote: '独立寻找合作伙伴并复盘项目结果',
          source_reference: 'jd',
          generation_index: 0,
        },
        {
          kind: 'preferred',
          text: '可补充渠道合作风险复盘案例',
          rationale: 'AI 提出的可选补充，需要 HR 核对是否适用于本岗。',
          needs_verification: true,
          source_kind: 'ai_suggestion',
          source_quote: '',
          source_reference: '',
          generation_index: 1,
        },
      ],
    };
    return route.fulfill({ json: generated });
  });
  await page.goto('/#talent-profiles');
  await expect(page.getByLabel('职位状态', { exact: true })).toContainText('全部状态');
  await page
    .getByRole('row')
    .filter({ hasText: job.title })
    .getByRole('button', { name: 'AI 起草招人要求', exact: true })
    .click();
  await expect(page.getByLabel('对外职位描述', { exact: true })).toHaveValue(job.jd);
  expect(modelPosts).toBe(0);
  await page.getByLabel('希望入职后完成什么（可选）').fill('首个季度完成渠道试点并形成复盘记录。');
  await page.getByRole('button', { name: 'AI 生成要求', exact: true }).click();
  await expect(
    page.getByRole('checkbox', { name: '必须满足 · 能够独立开展渠道拓展并复盘项目结果' }),
  ).toBeChecked();
  await expect(page.getByText('AI 建议，需自行核对', { exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: '优先考虑 · 可补充渠道合作风险复盘案例' }).uncheck();
  expect((await readJob(page, job.id)).latest_profile).toBeNull();
  expect((await readJob(page, job.id)).active_profile).toBeNull();

  await page.getByLabel('对外职位描述', { exact: true }).fill('临时改写，尚未保存');
  await expect(page.getByRole('button', { name: '采用这份草稿', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '最近 AI 草稿', exact: true }).click();
  await page
    .getByRole('button', { name: /查看草稿/ })
    .first()
    .click();
  await page.getByRole('button', { name: '恢复这次输入', exact: true }).click();
  await expect(page.getByLabel('对外职位描述', { exact: true })).toHaveValue(job.jd);
  await expect(page.getByRole('button', { name: '采用这份草稿', exact: true })).toBeDisabled();
  await page
    .getByRole('button', { name: /查看草稿/ })
    .last()
    .click();
  await page.getByRole('checkbox', { name: '优先考虑 · 可补充渠道合作风险复盘案例' }).uncheck();
  await expect(page.getByRole('button', { name: '采用这份草稿', exact: true })).toBeEnabled();

  await page.getByRole('button', { name: '采用这份草稿', exact: true }).click();
  await expect(page.getByLabel('具体要求 1', { exact: true })).toHaveValue(
    '能够独立开展渠道拓展并复盘项目结果',
  );
  await expect(page.getByLabel('具体要求 1', { exact: true })).toBeHidden();
  await page.getByLabel('展开或收起要求 1', { exact: true }).click();
  expect((await readJob(page, job.id)).active_profile).toBeNull();
  await page
    .getByLabel('具体要求 1', { exact: true })
    .fill('能用一个实际项目说明渠道拓展及复盘过程');
  await page
    .getByLabel('对外职位描述', { exact: true })
    .fill('采用后修改需求，旧 AI 草稿不能继续保存');
  await expect(page.getByRole('button', { name: '保存并使用', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '保存要求草稿', exact: true })).toBeDisabled();
  await expect(page.getByRole('status')).toContainText('草稿需要重新生成并采用后才能保存');
  await expect(page.getByLabel('具体要求 1', { exact: true })).toHaveValue(
    '能用一个实际项目说明渠道拓展及复盘过程',
  );
  await page.getByLabel('对外职位描述', { exact: true }).fill(job.jd);
  await expect(page.getByRole('button', { name: '保存并使用', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '保存并使用', exact: true })).toBeInViewport();
  await page.screenshot({ path: '../../.local/人才画像-AI编辑面板.png' });

  // 浏览器虚构生成编号不写入真实业务接口，只验证采用后的保存契约与失败保留输入。
  let saved: Record<string, unknown> | undefined;
  await page.route(`**/api/v1/jobs/${job.id}/profiles/`, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    saved = route.request().postDataJSON();
    return route.fulfill({
      status: 503,
      json: { errors: { detail: '验收保存暂未完成，请重试。' } },
    });
  });
  await page.getByRole('button', { name: '保存并使用', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('验收保存暂未完成');
  expect(saved).toMatchObject({
    version: job.version,
    activate: true,
    generation_id: 90211,
    business_goal: '首个季度完成渠道试点并形成复盘记录。',
    requirements: [{ generation_index: 0, text: '能用一个实际项目说明渠道拓展及复盘过程' }],
  });
  await expect(page.getByLabel('具体要求 1', { exact: true })).toHaveValue(
    '能用一个实际项目说明渠道拓展及复盘过程',
  );
  expect((await readJob(page, job.id)).active_profile).toBeNull();
});

test('长画像折叠核对、生效版变化摘要与固定保存区，空白要求校验可展开定位', async ({ page }) => {
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
  // 最新草稿与生效版不同，比较必须读取 v1，不能把 v2 当作已生效。
  job = await post(page, `jobs/${job.id}/profiles/`, {
    version: job.version,
    jd: job.jd,
    source: '虚构招聘标准草稿',
    requirements: job.latest_profile?.requirements,
  });
  await openProfile(page, job.title);
  const reason = page
    .getByText('为什么需要这项要求：结合本人案例核对职责与结果', { exact: true })
    .first();
  await expect(reason).toBeHidden();
  await page.getByText('查看来源和原因', { exact: true }).first().click();
  await expect(reason).toBeVisible();
  await page.getByRole('button', { name: '调整要求', exact: true }).click();
  await expect(page.getByRole('region', { name: '岗位要求摘要' })).toContainText('必备 6');
  await expect(page.getByRole('region', { name: '岗位要求摘要' })).toContainText('加分 8');
  await expect(page.getByRole('region', { name: '岗位要求摘要' })).toContainText('要求未确定 0');
  const changes = page.getByRole('alert', { name: '与生效版本比较' });
  await expect(changes).toContainText('相对当前生效 v1');
  await expect(changes).toContainText('要求变更：新增 0 · 删除 0 · 修改 0');
  await expect(page.getByLabel('对外职位描述', { exact: true })).toBeHidden();
  await expect(page.getByLabel('具体要求 1', { exact: true })).toBeHidden();
  const save = page.getByRole('button', { name: '保存并使用', exact: true });
  await expect(save).toBeInViewport();
  const first = page.getByLabel('展开或收起要求 1', { exact: true });
  await first.focus();
  await first.press('Enter');
  await page.getByLabel('具体要求 1', { exact: true }).fill('可以独立说明渠道试点的本人贡献');
  await first.click();
  await page.getByLabel('展开或收起要求 2', { exact: true }).click();
  await page.getByRole('button', { name: '删除要求 2', exact: true }).click();
  await page.getByRole('button', { name: '添加一项要求', exact: true }).click();
  await expect(save).toBeInViewport();
  const added = page.getByLabel('具体要求 15', { exact: true });
  await expect(added).toBeVisible();
  await added.fill('   ');
  await page.getByLabel('展开或收起要求 15', { exact: true }).click();
  await save.click();
  await expect(added).toBeVisible();
  await expect(added).toBeFocused();
  expect((await readJob(page, job.id)).latest_profile?.number).toBe(2);
  await added.fill('可补充一个风险识别案例');
  await expect(changes).toContainText('要求变更：新增 1 · 删除 1 · 修改 1');
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
});

test('AI 失败保留输入，HR 手工保存并使用后刷新与职位入口看到同一生效版本', async ({ page }) => {
  await login(page);
  const job = await createJob(page, '渠道经理（失败恢复虚构验收）');
  await openProfile(page, job.title);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'AI 起草招人要求', exact: true })
    .click();
  await page.getByLabel('对外职位描述', { exact: true }).fill('负责渠道试点和项目复盘。');
  await page.getByLabel('希望入职后完成什么（可选）').fill('完成渠道试点，形成可复用项目记录。');
  await page.getByLabel('要求来源').fill('虚构验收需求，由 HR 核对。');
  await page.getByLabel('具体要求 1', { exact: true }).fill('能说明本人负责的渠道项目及复盘结果');
  await page.route(`**/api/v1/jobs/${job.id}/profile-ai/`, (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ status: 503, json: { errors: { detail: '模型服务暂不可用，请重试。' } } })
      : route.fallback(),
  );
  await page.getByRole('button', { name: 'AI 生成要求', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('模型服务暂不可用');
  await expect(page.getByLabel('对外职位描述', { exact: true })).toHaveValue(
    '负责渠道试点和项目复盘。',
  );
  await expect(page.getByLabel('希望入职后完成什么（可选）')).toHaveValue(
    '完成渠道试点，形成可复用项目记录。',
  );
  await expect(page.getByLabel('具体要求 1', { exact: true })).toHaveValue(
    '能说明本人负责的渠道项目及复盘结果',
  );
  await page.getByRole('button', { name: '保存并使用', exact: true }).click();
  await expect(page.getByLabel('具体要求 1', { exact: true })).toHaveCount(0);
  const active = await readJob(page, job.id);
  expect(active.active_profile).toBe(active.latest_profile?.id);
  expect(active.latest_profile?.status).toBe('confirmed');
  expect(active.latest_profile?.confirmed_by_name).toBe('体验 HR');
  await page.reload();
  await page.getByLabel('搜索职位', { exact: true }).fill('失败恢复虚构验收');
  await page.getByLabel('职位状态', { exact: true }).click();
  await page.getByRole('option', { name: /关闭/ }).click();
  await expect(page.getByText('没有符合条件的职位', { exact: true })).toBeVisible();
  await page.getByLabel('职位状态', { exact: true }).click();
  await page.getByRole('option', { name: /草稿/ }).click();
  await expect(page.getByRole('row').filter({ hasText: job.title })).toContainText(
    '已确定，可以对照简历',
  );
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
