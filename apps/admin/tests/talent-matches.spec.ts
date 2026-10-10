import { expect, type Page, test } from '@playwright/test';
import type { ProfileAnalysis } from '../src/pages/application-profile';
import { login } from './helpers';

const resume = '虚构测试人选，开发内部检索工具。';
const requirements = [
  {
    id: 701,
    kind: 'must' as const,
    text: '有检索开发经验',
    rationale: '负责内部搜索',
    needs_verification: false,
  },
  {
    id: 702,
    kind: 'preferred' as const,
    text: '业务指标提升经验',
    rationale: '',
    needs_verification: false,
  },
  {
    id: 703,
    kind: 'exclusion' as const,
    text: '无法投入约定的项目时间',
    rationale: '',
    needs_verification: true,
  },
];
const report: ProfileAnalysis = {
  id: 901,
  code: 'AIS-0901',
  created_at: '2026-10-04T01:00:00Z',
  summary: '有检索实现相关原文，业务指标尚待补充。',
  requirement_matches: requirements.map((item, index) => ({
    requirement_id: item.id,
    kind: item.kind,
    text: item.text,
    needs_verification: item.needs_verification,
    status: index === 0 ? 'supported' : 'insufficient',
    quote: index === 0 ? '开发内部检索工具' : '',
    reason: index === 0 ? '简历提及对应项目。' : '需要补充实际依据。',
    question: '请说明具体实现与测试过程。',
    question_index: index === 0 ? 0 : null,
  })),
  source_context: {
    resume,
    source: {
      kind: 'application_resume',
      filename: 'fictional.pdf',
      parse_version: 1,
      resume_parse_id: 401,
      note: '',
    },
    job: {
      id: 301,
      title: '虚构检索岗位',
      version: 2,
      description: '内部检索开发',
      profile_id: 601,
      profile_version: 1,
      requirements,
    },
    application: { id: 101, version: 1 },
    captured_at: '2026-10-04T01:00:00Z',
  },
  source_status: { profile_stale: false, material_stale: false },
  questions: [
    {
      question: '请说明具体实现与测试过程。',
      follow_up: '如何验证结果？',
      answer_points: ['给出测试依据'],
      requirement_id: 701,
    },
  ],
  verifications: [],
};
const application = {
  id: 101,
  profile: 601,
  candidate: 201,
  name: '虚构测试人选',
  job: 301,
  job_title: '虚构检索岗位',
  attempt_no: 1,
  stage: 'pending_review',
  version: 1,
  source: '其他',
  owner_name: '测试 HR',
  close_reason: '',
  phone: '',
  email: '',
  contact_note: '仅测试材料',
  job_status: 'open',
  handlers: [],
  interviewers: [] as { id: number; name: string }[],
  requirements,
  reviews: [],
  resumes: [
    {
      document: 501,
      name: 'fictional.pdf',
      download: false,
      parse: {
        id: 401,
        version: 1,
        status: 'succeeded',
        text: resume,
        error: '',
        parser_version: 'test',
        actor_name: '测试 HR',
      },
    },
  ],
  profile_analysis: null as typeof report | null,
};

async function prepare(page: Page, detail = application) {
  await page.route(/\/api\/v1\/applications\/(?:\?.*)?$/, (route) =>
    route.fulfill({ json: { results: [detail], count: 1, next: null, previous: null } }),
  );
  await page.route('**/api/v1/applications/filter-options/', (route) =>
    route.fulfill({ json: { jobs: [{ job_id: 301, job__title: '虚构检索岗位' }] } }),
  );
  await page.route('**/api/v1/applications/101/', (route) => route.fulfill({ json: detail }));
  await login(page);
  await page.goto('/#talent-profiles');
  await page.getByRole('tab', { name: '简历对照', exact: true }).click();
  await page.getByRole('button', { name: '查看简历并对照', exact: true }).click();
  await page.getByRole('tab', { name: '岗位对照', exact: true }).click();
  return page.getByRole('region', { name: '候选人画像分析', exact: true });
}

test('按本次应聘和简历分析，逐项依据、核实记录及失败重试形成连续操作', async ({ page }) => {
  let requests = 0;
  const keys: string[] = [];
  let release = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/ai-screenings/', async (route) => {
    const body = route.request().postDataJSON();
    expect(body).toMatchObject({ application_id: 101, job_id: 301, resume_parse_id: 401, resume });
    keys.push(body.request_key);
    requests++;
    if (requests === 1) await pending;
    if (requests === 2)
      return route.fulfill({
        status: 503,
        json: { errors: { detail: '测试模型暂时不可用，材料仍保留。' } },
      });
    return route.fulfill({ json: report });
  });
  const panel = await prepare(page);
  await panel.getByRole('button', { name: 'AI 分析候选人画像', exact: true }).click();
  await expect(panel.getByRole('button', { name: '正在对照岗位要求…' })).toBeDisabled();
  await panel.getByRole('tab', { name: '应聘概览', exact: true }).click();
  await expect(page.getByRole('button', { name: '提交人工处理结果' })).toBeDisabled();
  await panel.getByRole('tab', { name: '岗位对照', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(panel).toBeVisible();
  release();
  const matches = panel.getByRole('region', { name: '岗位要求与材料对照' });
  await matches.getByText('查看材料依据与 AI 说明').first().click();
  await expect(matches).toContainText('简历原文：开发内部检索工具');
  await expect(matches).toContainText('材料支持 1 项');
  await expect(matches).toContainText('信息不足 1 项');
  await expect(matches).toContainText('岗位要求待确认 1 项');
  await expect(matches).toContainText('岗位要求待确认');
  await page.route('**/api/v1/ai-screenings/901/verifications/', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: 1,
            question_index: 0,
            version: 1,
            status: 'pending',
            answer: '',
            evidence: '',
            next_step: '',
            contact_name: '',
            due_on: null,
            recorder_name: '测试 HR',
            created_at: '2026-10-04T02:00:00Z',
          },
        ],
        history: [],
        count: 1,
        page: 1,
      },
    }),
  );
  await panel.getByRole('button', { name: '加入待核实' }).click();
  const verifications = panel.getByRole('region', { name: '人工核实' });
  await expect(verifications).toContainText('待核实');
  await panel.getByRole('button', { name: '记录核实', exact: true }).click();
  await expect(panel.getByRole('button', { name: '重新分析当前材料' })).toBeDisabled();
  await panel.getByRole('tab', { name: '应聘概览', exact: true }).click();
  await expect(page.getByRole('button', { name: '提交人工处理结果' })).toBeDisabled();
  await panel.getByRole('tab', { name: '岗位对照', exact: true }).click();
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.keyboard.press('Escape');
  await expect(panel.getByText('记录第 1 题的核实结果')).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await panel.getByRole('button', { name: '取消编辑', exact: true }).click();
  await panel.getByRole('button', { name: '重新分析当前材料' }).click();
  await expect(panel.getByRole('alert')).toContainText('测试模型暂时不可用');
  await expect(verifications).toContainText('待核实');
  await panel.getByRole('button', { name: '重新分析当前材料' }).click();
  await expect(panel.getByRole('alert')).toHaveCount(0);
  expect(keys[1]).toBe(keys[2]);
  expect(keys[0]).not.toBe(keys[1]);
});

test('候选人画像共享报告也显示版本、日期、模型异常和系统补题来源', async ({ page }) => {
  const current: ProfileAnalysis = {
    ...report,
    quality_version: 2,
    analysis_date: '2026-10-08',
    analysis_issues: ['虚构模型引用未能通过原文校验，请重新分析。'],
    requirement_matches: report.requirement_matches.map((item, index) =>
      index === 1
        ? { ...item, status: 'analysis_error', quote: '', reason: '引用无法定位，不评价人选能力。' }
        : item,
    ),
    questions: report.questions.map((item) => ({ ...item, origin: 'verification_fallback' })),
  };
  await page.route('**/api/v1/ai-screenings/', (route) => route.fulfill({ json: current }));
  const panel = await prepare(page, { ...application, profile_analysis: report });
  await expect(panel.getByText('旧版报告，建议重新分析', { exact: true })).toBeVisible();
  await expect(panel).toContainText('原始记录已保留');
  await expect(panel.getByText(/日期判断基准/)).toHaveCount(0);
  await panel.getByRole('button', { name: '重新分析当前材料', exact: true }).click();
  await expect(panel.getByText('旧版报告，建议重新分析', { exact: true })).toHaveCount(0);
  await expect(panel).toContainText('日期判断基准：2026-10-08');
  const quality = panel.getByRole('status').filter({ hasText: '分析质量提示' });
  await expect(quality).toContainText('以下问题来自模型输出，不代表候选人材料不足');
  await expect(quality).toContainText('虚构模型引用未能通过原文校验，请重新分析。');
  const matches = panel.getByRole('region', { name: '岗位要求与材料对照' });
  await expect(matches).toContainText('分析需重试 1 项');
  await expect(matches).toContainText('信息不足 0 项');
  const verification = panel.getByRole('region', { name: '人工核实', exact: true });
  await expect(verification.getByText('系统补齐的核实题', { exact: true })).toBeVisible();
  await expect(verification).toContainText(current.questions[0].question);
});

test('历史报告标出标准和材料过期，缺少简历或标准时不能生成', async ({ page }) => {
  const panel = await prepare(page, {
    ...application,
    resumes: [],
    profile_analysis: { ...report, source_status: { profile_stale: true, material_stale: true } },
  });
  await expect(panel.getByRole('alert')).toContainText('岗位标准已改变。应聘材料已改变。');
  await expect(panel).toContainText('暂时没有可分析的简历文字');
  await expect(panel.getByRole('button', { name: /分析当前材料|AI 分析候选人画像/ })).toHaveCount(
    0,
  );
  await expect(panel).toContainText(report.summary);
  await page.route('**/api/v1/applications/101/', (route) =>
    route.fulfill({ json: { ...application, profile: null, requirements: [] } }),
  );
  await page.reload();
  await page.getByRole('tab', { name: '简历对照', exact: true }).click();
  await page.getByRole('button', { name: '查看简历并对照', exact: true }).click();
  await expect(panel).toContainText('此职位尚未启用岗位画像');
  await expect(panel.getByRole('button', { name: 'AI 分析候选人画像' })).toHaveCount(0);
});

test('候选人画像筛选与空状态可恢复', async ({ page }) => {
  await prepare(page);
  await page.keyboard.press('Escape');
  await page.route(/\/api\/v1\/applications\/(?:\?.*)?$/, (route) => {
    const query = new URL(route.request().url()).searchParams;
    return route.fulfill({
      json: {
        results: query.get('search') ? [] : [application],
        count: query.get('search') ? 0 : 1,
        next: null,
        previous: null,
      },
    });
  });
  await page.getByLabel('搜索候选人或职位', { exact: true }).fill('不存在');
  await expect(page.getByText('没有找到这个候选人', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '清除搜索', exact: true }).click();
  await expect(page.getByLabel('搜索候选人或职位', { exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: '查看简历并对照', exact: true })).toBeVisible();
});

test('切换简历不会误用旧报告，刷新应聘会更新过期提示', async ({ page }) => {
  const panel = await prepare(page, {
    ...application,
    profile_analysis: report,
    resumes: [
      ...application.resumes,
      {
        ...application.resumes[0],
        document: 502,
        name: '另一份虚构简历.pdf',
        parse: { ...application.resumes[0].parse, id: 402, text: '另一份虚构材料' },
      },
    ],
  });
  await panel.getByLabel('本次分析材料', { exact: true }).click();
  await page.getByRole('option', { name: '另一份虚构简历.pdf · 文字 v1' }).click();
  await expect(panel.getByRole('alert')).toContainText('当前所选材料尚未分析');
  await expect(panel.getByRole('button', { name: '加入待核实' })).toBeDisabled();
  await panel.getByLabel('本次分析材料', { exact: true }).click();
  await page.getByRole('option', { name: /fictional\.pdf/ }).click();
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: '加入待核实' })).toBeEnabled();
  await panel.getByRole('tab', { name: '应聘概览', exact: true }).click();
  await page.route('**/api/v1/applications/101/review/', (route) =>
    route.fulfill({
      json: {
        ...application,
        version: 2,
        profile_analysis: {
          ...report,
          source_status: { profile_stale: false, material_stale: true },
        },
      },
    }),
  );
  await page.getByLabel('依据与说明').fill('虚构验收：查看刷新后材料状态。');
  await page.getByRole('button', { name: '提交人工处理结果' }).click();
  await expect(panel.getByRole('alert')).toContainText('应聘材料已改变');
});

test('刷新应聘期间暂停分析，读取完成后才允许生成新报告', async ({ page }) => {
  const panel = await prepare(page, {
    ...application,
    stage: 'ready_to_schedule',
    interviewers: [{ id: 801, name: '虚构面试官' }],
    profile_analysis: report,
  });
  await page.getByRole('tab', { name: '应聘概览', exact: true }).click();
  let release = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/interviews/', (route) => route.fulfill({ json: { id: 1001 } }));
  await page.route('**/api/v1/applications/101/', async (route) => {
    await pending;
    return route.fulfill({
      json: { ...application, version: 2, stage: 'interviewing', profile_analysis: report },
    });
  });
  let analyses = 0;
  await page.route('**/api/v1/ai-screenings/', (route) => {
    analyses++;
    return route.fulfill({ json: { ...report, id: 902, code: 'AIS-0902' } });
  });
  await page.getByLabel('本轮目标', { exact: true }).fill('核实检索项目实现');
  await page.getByLabel('开始时间（北京时间）').fill('2030-01-02T10:00');
  await page.getByLabel('结束时间（北京时间）').fill('2030-01-02T11:00');
  await page.getByLabel('面试地点', { exact: true }).fill('虚构测试会议室');
  await page.getByRole('checkbox', { name: '虚构面试官' }).check();
  const refreshed = page.waitForRequest('**/api/v1/applications/101/');
  await page.getByRole('button', { name: '保存排期', exact: true }).click();
  await refreshed;
  await expect(page.getByText('正在刷新应聘资料，请稍候。')).toBeVisible();
  await expect(panel.getByRole('button', { name: '重新分析当前材料' })).toBeDisabled();
  await expect(panel.getByRole('button', { name: '加入待核实' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '提交人工处理结果' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '保存排期', exact: true })).toBeDisabled();
  expect(analyses).toBe(0);
  release();
  await page.getByRole('tab', { name: '岗位对照', exact: true }).click();
  await expect(panel.getByRole('button', { name: '重新分析当前材料' })).toBeEnabled();
  await panel.getByRole('button', { name: '重新分析当前材料' }).click();
  await expect(panel).toContainText('报告 AIS-0902');
  await expect(panel).not.toContainText('报告 AIS-0901');
  expect(analyses).toBe(1);
});

test('本地生成后刷新返回空报告会移除结果，不沿用已经不可见的资料', async ({ page }) => {
  const panel = await prepare(page);
  await page.route('**/api/v1/ai-screenings/', (route) => route.fulfill({ json: report }));
  await panel.getByRole('button', { name: 'AI 分析候选人画像', exact: true }).click();
  await expect(panel).toContainText('报告 AIS-0901');
  await panel.getByRole('tab', { name: '应聘概览', exact: true }).click();
  await page.route('**/api/v1/applications/101/review/', (route) =>
    route.fulfill({ json: { ...application, version: 2, profile_analysis: null } }),
  );
  await page.getByLabel('依据与说明').fill('虚构核对记录');
  await page.getByRole('button', { name: '提交人工处理结果' }).click();
  await expect(panel).not.toContainText('报告 AIS-0901');
  await expect(panel.getByRole('region', { name: '岗位要求与材料对照' })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'AI 分析候选人画像', exact: true })).toBeEnabled();
});

for (const state of ['missing', 'unknown'] as const) {
  test(`旧报告来源状态${state === 'missing' ? '缺失' : '未知'}时明确提示重新分析`, async ({
    page,
  }) => {
    const panel = await prepare(page, {
      ...application,
      profile_analysis: {
        ...report,
        requirement_matches: [],
        source_status:
          state === 'missing' ? undefined : { profile_stale: null, material_stale: null },
      },
    });
    await expect(panel.getByRole('alert')).toContainText('无法确认是否仍适用，请重新分析');
    await expect(panel.getByRole('region', { name: '岗位要求与材料对照' })).toHaveCount(0);
    await expect(panel).toContainText('此报告没有逐项对照记录');
    await panel.getByRole('tab', { name: '应聘概览', exact: true }).click();
    await page.route('**/api/v1/applications/101/review/', (route) =>
      route.fulfill({
        json: {
          ...application,
          version: 2,
          profile_analysis: {
            ...report,
            source_status: { profile_stale: null, material_stale: false },
          },
        },
      }),
    );
    await page.getByLabel('依据与说明').fill('使用可核对的画像版本');
    await page.getByRole('button', { name: '提交人工处理结果' }).click();
    await expect(panel.getByRole('alert')).toHaveCount(0);
  });
}
