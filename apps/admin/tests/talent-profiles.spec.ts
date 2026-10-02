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

async function openProfile(page: Page, title: string, editable = true) {
  await page.goto('/#talent-profiles');
  await expect(page.getByRole('heading', { name: '人才画像', exact: true })).toBeVisible();
  await page
    .getByRole('row')
    .filter({ hasText: title })
    .getByRole('button', { name: editable ? '编辑画像' : '查看画像', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
}

test('AI 仅生成可编辑建议，采用不生效，保存请求携带来源与明确使用动作', async ({ page }) => {
  await login(page);
  const job = await createJob(page, '渠道经理（AI 画像虚构验收）');
  await openProfile(page, job.title);
  await expect(page.getByLabel('职位状态', { exact: true })).toContainText('全部状态');
  await page.getByRole('button', { name: 'AI 起草画像', exact: true }).click();
  await page.getByLabel('业务目标（可选）').fill('首个季度完成渠道试点并形成复盘记录。');

  // 仅模拟模型返回；真实来源入库、幂等与校验由后端测试验证，不调用真实模型。
  let generated: Record<string, unknown> | null = null;
  await page.route(`**/api/v1/jobs/${job.id}/profile-ai/`, async (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({
        json: {
          items: generated
            ? [{ ...generated, id: 90210, job_version: job.version - 1 }, generated]
            : [],
        },
      });
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
  await expect(page.getByLabel('具体要求 1')).toHaveValue('能够独立开展渠道拓展并复盘项目结果');
  expect((await readJob(page, job.id)).active_profile).toBeNull();
  await page.getByLabel('具体要求 1').fill('能用一个实际项目说明渠道拓展及复盘过程');
  await page.getByRole('button', { name: '保存并使用', exact: true }).scrollIntoViewIfNeeded();
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
  await expect(page.getByLabel('具体要求 1')).toHaveValue('能用一个实际项目说明渠道拓展及复盘过程');
  expect((await readJob(page, job.id)).active_profile).toBeNull();
});

test('AI 失败保留输入，HR 手工保存并使用后刷新与职位入口看到同一生效版本', async ({ page }) => {
  await login(page);
  const job = await createJob(page, '渠道经理（失败恢复虚构验收）');
  await openProfile(page, job.title);
  await page.getByRole('button', { name: 'AI 起草画像', exact: true }).click();
  await page.getByLabel('对外职位描述', { exact: true }).fill('负责渠道试点和项目复盘。');
  await page.getByLabel('业务目标（可选）').fill('完成渠道试点，形成可复用项目记录。');
  await page.getByLabel('要求来源').fill('虚构验收需求，由 HR 核对。');
  await page.getByLabel('具体要求 1').fill('能说明本人负责的渠道项目及复盘结果');
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
  await expect(page.getByLabel('业务目标（可选）')).toHaveValue(
    '完成渠道试点，形成可复用项目记录。',
  );
  await expect(page.getByLabel('具体要求 1')).toHaveValue('能说明本人负责的渠道项目及复盘结果');
  await page.getByRole('button', { name: '保存并使用', exact: true }).click();
  await expect(page.getByLabel('具体要求 1')).toHaveCount(0);
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
  await expect(page.getByRole('row').filter({ hasText: job.title })).toContainText('v1 · 已生效');
  await page.screenshot({ path: '../../.local/人才画像-岗位列表.png', fullPage: true });
  await openProfile(page, job.title);
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
      await openProfile(reader, job.title, false);
      await expect(reader.getByText('能够复盘渠道项目结果', { exact: true })).toBeVisible();
      for (const name of ['AI 起草画像', '调整要求', '使用此版本', '保存并使用']) {
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
