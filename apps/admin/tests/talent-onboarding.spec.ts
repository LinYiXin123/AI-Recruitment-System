import { expect, type Page, test } from '@playwright/test';
import type { Job } from '../src/lib/api';
import type { Application, Batch, Candidate, ImportItem } from '../src/lib/intake';
import { login } from './helpers';

const job: Job = {
  id: 93101,
  title: '虚构渠道岗位',
  department: 1,
  department_name: '虚构测试部门',
  company_name: '',
  job_level: '',
  salary_range: '',
  base_salary: '',
  performance_salary: '',
  commission_salary: '',
  total_monthly_salary: '',
  planned_publish_date: null,
  location: '深圳',
  headcount: 1,
  owner_name: '测试 HR',
  approver_name: '测试负责人',
  status: 'open',
  jd: '负责渠道合作和项目复盘。',
  version: 2,
  updated_at: '2026-10-08T01:00:00Z',
  active_profile: 93201,
  active_profile_number: 1,
  latest_profile: {
    id: 93201,
    number: 1,
    jd_snapshot: '负责渠道合作和项目复盘。',
    source: '虚构验收标准',
    status: 'confirmed',
    requirements: [],
    created_at: '2026-10-08T01:00:00Z',
    created_by_name: '测试 HR',
    confirmed_by_name: '测试 HR',
    confirmed_at: '2026-10-08T01:00:00Z',
    review_note: '',
  },
  permissions: { edit: true, confirm: false },
};
const application: Application = {
  id: 93301,
  profile: 93201,
  candidate: 93401,
  name: '虚构渠道候选人',
  job: job.id,
  job_title: job.title,
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
  interviewers: [],
  requirements: [],
  resumes: [],
  reviews: [],
  profile_analysis: null,
};
const otherJob = { ...job, id: 93102, title: '虚构设计岗位' };
const otherApplication = {
  ...application,
  id: 93302,
  candidate: 93402,
  name: '虚构设计候选人',
  job: otherJob.id,
  job_title: otherJob.title,
};
const candidate: Candidate = {
  id: application.candidate,
  display_name: application.name,
  phone: '',
  email: '',
  contact_note: '仅测试材料',
  applications: [],
};

async function prepare(
  page: Page,
  applications = [application, otherApplication],
  editable = true,
) {
  // 只模拟页面流转数据；登录使用隔离验收服务，不写入候选人或应聘记录。
  await login(page);
  const jobs = [job, otherJob].map((item) => ({
    ...item,
    permissions: { ...item.permissions, edit: editable },
  }));
  await page.route(/\/api\/v1\/jobs\/(?:\?.*)?$/, (route) =>
    route.fulfill({ json: { count: jobs.length, next: null, previous: null, results: jobs } }),
  );
  for (const item of jobs) {
    await page.route(`**/api/v1/jobs/${item.id}/`, (route) => route.fulfill({ json: item }));
  }
  const requestedJobs: string[] = [];
  await page.route(/\/api\/v1\/applications\/(?:\?.*)?$/, (route) => {
    const query = new URL(route.request().url()).searchParams;
    const jobId = query.get('job') || '';
    requestedJobs.push(jobId);
    // 按真实接口的 job 参数筛选，误用 job_id 时不能被模拟响应掩盖。
    const results = applications.filter((item) => !jobId || String(item.job) === jobId);
    return route.fulfill({ json: { count: results.length, next: null, previous: null, results } });
  });
  await page.route('**/api/v1/applications/filter-options/', (route) =>
    route.fulfill({
      json: {
        jobs: applications.map((item) => ({ job_id: item.job, job__title: item.job_title })),
      },
    }),
  );
  await page.route(`**/api/v1/applications/${application.id}/`, (route) =>
    route.fulfill({ json: application }),
  );
  await page.route(/\/api\/v1\/candidates\/(?:\?.*)?$/, (route) =>
    route.fulfill({ json: { count: 1, next: null, previous: null, results: [candidate] } }),
  );
  await page.goto('/#talent-profiles');
  return requestedJobs;
}

test('已确定要求的岗位直接查看候选人，按该岗位筛选且可恢复全部', async ({ page }) => {
  const requestedJobs = await prepare(page);
  await page
    .getByRole('row')
    .filter({ hasText: job.title })
    .getByRole('button', { name: '查看候选人', exact: true })
    .click();
  await expect(page.getByRole('tab', { name: '简历对照', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByLabel('目标职位', { exact: true })).toContainText(job.title);
  await expect(page.getByRole('row').filter({ hasText: application.name })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: otherApplication.name })).toHaveCount(0);
  expect(requestedJobs).toContain(String(job.id));

  await page.getByRole('button', { name: '重置', exact: true }).click();
  await expect(page.getByLabel('目标职位', { exact: true })).toContainText('全部职位');
  await expect(page.getByRole('row').filter({ hasText: otherApplication.name })).toBeVisible();
  expect(requestedJobs.at(-1)).toBe('');
});

test('零应聘岗位保留选岗上下文，选人不会自动加入，明确确认后才建立应聘', async ({ page }) => {
  await prepare(page, []);
  const saved: unknown[] = [];
  await page.route(`**/api/v1/candidates/${candidate.id}/apply/`, (route) => {
    saved.push(route.request().postDataJSON());
    return route.fulfill({ json: { application: application.id } });
  });
  await page
    .getByRole('row')
    .filter({ hasText: job.title })
    .getByRole('button', { name: '查看候选人', exact: true })
    .click();
  await expect(page.getByLabel('目标职位', { exact: true })).toContainText(job.title);
  await page.getByRole('button', { name: '选择候选人', exact: true }).first().click();
  const picker = page.getByRole('dialog', { name: '选择候选人', exact: true });
  await expect(picker.getByLabel('搜索已有候选人', { exact: true })).toBeVisible();
  await picker.getByRole('button', { name: '选择此人', exact: true }).click();
  expect(saved).toHaveLength(0);
  await picker.getByLabel('材料来源', { exact: true }).fill('内部推荐');
  await picker.getByRole('button', { name: '加入职位并继续', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: `${application.name} · 第 1 次应聘`, exact: true }),
  ).toBeVisible();
  expect(saved).toEqual([
    expect.objectContaining({
      job: job.id,
      source: '内部推荐',
      request_key: expect.stringMatching(/^[0-9a-f-]{36}$/i),
    }),
  ]);
});

test('没有岗位编辑权限时可查看已有对照，不提供新增应聘入口', async ({ page }) => {
  await prepare(page, [application], false);
  let posted = 0;
  await page.route('**/api/v1/candidates/*/apply/', (route) => {
    posted++;
    return route.fulfill({ status: 403, json: { errors: { detail: '没有权限' } } });
  });
  await page
    .getByRole('row')
    .filter({ hasText: job.title })
    .getByRole('button', { name: '查看候选人', exact: true })
    .click();
  await expect(page.getByRole('row').filter({ hasText: application.name })).toBeVisible();
  await expect(page.getByRole('button', { name: '选择候选人', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '加入职位并继续', exact: true })).toHaveCount(0);
  expect(posted).toBe(0);
});

test('同岗位已有进行中应聘时直接打开，不重复创建记录', async ({ page }) => {
  await prepare(page);
  await page.route(/\/api\/v1\/candidates\/(?:\?.*)?$/, (route) =>
    route.fulfill({
      json: {
        count: 1,
        next: null,
        previous: null,
        results: [
          {
            ...candidate,
            applications: [
              {
                id: application.id,
                job_id: job.id,
                job__title: job.title,
                attempt_no: 1,
                stage: 'pending_review',
              },
            ],
          },
        ],
      },
    }),
  );
  let posted = 0;
  await page.route('**/api/v1/candidates/*/apply/', (route) => {
    posted++;
    return route.fulfill({ json: { application: application.id } });
  });
  await page
    .getByRole('row')
    .filter({ hasText: job.title })
    .getByRole('button', { name: '查看候选人', exact: true })
    .click();
  await page.getByRole('button', { name: '选择候选人', exact: true }).first().click();
  const picker = page.getByRole('dialog', { name: '选择候选人', exact: true });
  await picker.getByRole('button', { name: '选择此人', exact: true }).click();
  await expect(picker.getByRole('button', { name: '加入职位并继续', exact: true })).toHaveCount(0);
  await picker.getByRole('button', { name: '打开已有应聘', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: `${application.name} · 第 1 次应聘`, exact: true }),
  ).toBeVisible();
  expect(posted).toBe(0);
});

test('补充简历锁定本次应聘，核对失败保留依据并可重试，返回后使用新材料', async ({ page }) => {
  const storedApplication = {
    ...application,
    phone: '13700000000',
    email: 'archive@example.com',
  };
  await prepare(page, [storedApplication]);
  const item: ImportItem = {
    id: 93502,
    name: 'fictional-supplement.pdf',
    document: 93503,
    application: null,
    parse: {
      id: 93504,
      version: 1,
      status: 'succeeded',
      text: '姓名：测试乙\n电话：13800000000\n邮箱：other@example.com\n负责合作项目和复盘，仅供验收。',
      error: '',
      parser_version: '验收模拟文字提取',
      actor_name: '测试 HR',
    },
  };
  const pendingItem: ImportItem = {
    ...item,
    id: 93505,
    name: 'fictional-pending.pdf',
    document: 93506,
    parse: item.parse && { ...item.parse, id: 93507 },
  };
  let uploaded = 0;
  let confirmed = false;
  const batch = (): Batch => ({
    id: 93501,
    job: job.id,
    job_title: job.title,
    source: '本人补充',
    total: 2,
    received: uploaded,
    completed: confirmed ? 1 : 0,
    items: [{ ...item, application: confirmed ? application.id : null }, pendingItem].slice(
      0,
      uploaded,
    ),
    created_at: '2026-10-08T02:00:00Z',
  });
  const confirmations: Record<string, unknown>[] = [];
  let analysisRequests = 0;
  await page.route('**/api/v1/ai-screenings/', (route) => {
    analysisRequests++;
    return route.fulfill({ status: 503, json: { errors: { detail: '本用例不调用模型' } } });
  });
  await page.route('**/api/v1/imports/', (route) => {
    expect(route.request().postDataJSON()).toMatchObject({
      job: job.id,
      source: '本人补充',
      total: 2,
    });
    return route.fulfill({ status: 201, json: batch() });
  });
  await page.route('**/api/v1/imports/93501/upload/', (route) => {
    uploaded++;
    return route.fulfill({ status: 201, json: uploaded === 1 ? item : pendingItem });
  });
  await page.route('**/api/v1/imports/93501/', (route) => route.fulfill({ json: batch() }));
  await page.route('**/api/v1/imports/93501/items/93502/confirm/', (route) => {
    confirmations.push(route.request().postDataJSON());
    if (confirmations.length === 1)
      return route.fulfill({
        status: 503,
        json: { errors: { detail: '虚构确认失败，请重试。' } },
      });
    confirmed = true;
    return route.fulfill({ json: { ...item, application: application.id } });
  });
  await page.route(`**/api/v1/applications/${application.id}/`, (route) =>
    route.fulfill({
      json: {
        ...storedApplication,
        resumes: confirmed
          ? [{ document: item.document, name: item.name, download: false, parse: item.parse }]
          : [],
      },
    }),
  );

  await page.getByRole('tab', { name: '简历对照', exact: true }).click();
  await page.getByRole('button', { name: '查看简历并对照', exact: true }).click();
  await page.getByRole('button', { name: '补充简历', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: `补充简历 · ${application.name}`, exact: true });
  await expect(drawer).toContainText(`目标职位：${job.title}`);
  await expect(drawer).toContainText(`${application.name} · 第 1 次应聘`);
  await expect(drawer.getByLabel('目标职位', { exact: true })).toHaveCount(0);
  await drawer.getByLabel('材料来源', { exact: true }).fill('本人补充');
  // 此处只验收上传后的接线；真实 PDF 提取由 z-intake 用例覆盖。
  await drawer.getByLabel('简历文件', { exact: true }).setInputFiles(
    [item, pendingItem].map((file) => ({
      name: file.name,
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n% Fictional onboarding resume\n%%EOF'),
    })),
  );
  await drawer.getByRole('button', { name: '开始导入', exact: true }).click();
  await expect(drawer.getByRole('button', { name: '核对与继续', exact: true })).toHaveCount(2);
  let exitPrompts = 0;
  page.once('dialog', async (dialog) => {
    exitPrompts++;
    const message = dialog.message();
    await dialog.dismiss();
    expect(message).toContain('尚未核对');
    expect(message).toContain('重新导入');
  });
  await drawer.getByRole('button', { name: '关闭详情', exact: true }).click();
  expect(exitPrompts).toBe(1);
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText(item.name, { exact: true })).toBeVisible();
  await drawer.getByRole('button', { name: '核对与继续', exact: true }).first().click();
  await expect(drawer.getByLabel('姓名（人工核对）', { exact: true })).toHaveValue(
    application.name,
  );
  await expect(drawer.getByLabel('联系电话', { exact: true })).toHaveValue(storedApplication.phone);
  await expect(drawer.getByLabel('邮箱', { exact: true })).toHaveValue(storedApplication.email);
  for (const label of ['姓名（人工核对）', '联系电话', '邮箱', '联系方式缺失说明']) {
    await expect(drawer.getByLabel(label, { exact: true })).toHaveJSProperty('readOnly', true);
  }
  const confirm = drawer.getByRole('button', { name: '确认属于此人，补入本次应聘', exact: true });
  const note = drawer.getByLabel('核对依据', { exact: true });
  await confirm.click();
  await expect(note).toBeFocused();
  expect(confirmations).toHaveLength(0);
  await note.fill('原文姓名和本人补充说明与此档案一致。');
  await confirm.click();
  await expect(
    drawer.getByRole('alert').filter({ hasText: '虚构确认失败，请重试。' }),
  ).toBeVisible();
  await expect(note).toHaveValue('原文姓名和本人补充说明与此档案一致。');
  await confirm.click();
  page.once('dialog', async (dialog) => {
    exitPrompts++;
    const message = dialog.message();
    await dialog.dismiss();
    expect(message).toContain('尚未核对');
    expect(message).toContain('重新导入');
  });
  await drawer.getByRole('button', { name: '打开本次应聘', exact: true }).click();
  expect(exitPrompts).toBe(2);
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText(pendingItem.name, { exact: true })).toBeVisible();
  await expect(drawer.getByRole('button', { name: '核对与继续', exact: true })).toHaveCount(1);
  page.once('dialog', async (dialog) => {
    exitPrompts++;
    const message = dialog.message();
    await dialog.accept();
    expect(message).toContain('尚未核对');
    expect(message).toContain('重新导入');
  });
  await drawer.getByRole('button', { name: '打开本次应聘', exact: true }).click();
  expect(exitPrompts).toBe(3);
  expect(confirmations).toHaveLength(2);
  expect(confirmations[0]).toMatchObject({
    application: application.id,
    candidate: application.candidate,
    parse: item.parse?.id,
    display_name: storedApplication.name,
    phone: storedApplication.phone,
    email: storedApplication.email,
    identity_note: '原文姓名和本人补充说明与此档案一致。',
  });
  expect(confirmations[1]).toEqual(confirmations[0]);
  const detail = page.getByRole('dialog', {
    name: `${application.name} · 第 1 次应聘`,
    exact: true,
  });
  await expect(detail.getByLabel('本次分析材料', { exact: true })).toContainText(item.name);
  await expect(
    detail.getByRole('button', { name: 'AI 分析候选人画像', exact: true }),
  ).toBeEnabled();
  expect(analysisRequests).toBe(0);
});

test('新简历自动填写身份，重新加载保留人工修改和主动留空，多联系方式需人工核对', async ({
  page,
}) => {
  await prepare(page, []);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const firstItem: ImportItem = {
    id: 93602,
    name: 'fictional-identity.pdf',
    document: 93603,
    application: null,
    parse: {
      id: 93604,
      version: 1,
      status: 'succeeded',
      text: '[第 1 页]\n测试甲 求职意向：开发工程师\n电话：+86 138 0000 0000\n邮箱：test@example.com\n教育经历\n虚构大学，软件工程。',
      error: '',
      parser_version: '验收模拟文字提取',
      actor_name: '测试 HR',
    },
  };
  const secondItem: ImportItem = {
    ...firstItem,
    id: 93605,
    name: 'fictional-multiple-contacts.pdf',
    document: 93606,
    parse: firstItem.parse && {
      ...firstItem.parse,
      id: 93607,
      text: '姓名：测试乙\n电话：13800000001 / 13900000001\n邮箱：one@example.com / two@example.com\n教育经历\n虚构大学。',
    },
  };
  const refreshedItem: ImportItem = {
    ...firstItem,
    parse: firstItem.parse && {
      ...firstItem.parse,
      id: 93608,
      version: 2,
      text: '姓名：测试丙\n电话：139 0000 0000\n邮箱：fresh@example.com\n教育经历\n虚构大学，软件工程。',
    },
  };
  let uploaded = 0;
  let useRefreshed = false;
  let confirmed = false;
  const batch = (): Batch => ({
    id: 93601,
    job: job.id,
    job_title: job.title,
    source: '本人投递',
    total: 2,
    received: uploaded,
    completed: confirmed ? 1 : 0,
    items: [
      {
        ...(useRefreshed ? refreshedItem : firstItem),
        application: confirmed ? application.id : null,
      },
      secondItem,
    ].slice(0, uploaded),
    created_at: '2026-10-08T03:00:00Z',
  });
  const matches: Record<string, unknown>[] = [];
  const confirmations: Record<string, unknown>[] = [];
  await page.route('**/api/v1/imports/', (route) => route.fulfill({ status: 201, json: batch() }));
  await page.route('**/api/v1/imports/93601/upload/', (route) => {
    uploaded++;
    return route.fulfill({ status: 201, json: uploaded === 1 ? firstItem : secondItem });
  });
  await page.route('**/api/v1/imports/93601/', (route) => route.fulfill({ json: batch() }));
  await page.route('**/api/v1/imports/93601/items/93602/matches/', (route) => {
    matches.push(route.request().postDataJSON());
    return matches.length === 2
      ? route.fulfill({ status: 503, json: { errors: { detail: '虚构查重失败，请重新加载。' } } })
      : route.fulfill({ json: { results: [] } });
  });
  await page.route('**/api/v1/imports/93601/items/93602/confirm/', (route) => {
    confirmations.push(route.request().postDataJSON());
    confirmed = true;
    return route.fulfill({ json: { ...refreshedItem, application: application.id } });
  });

  await page
    .getByRole('row')
    .filter({ hasText: job.title })
    .getByRole('button', { name: '查看候选人', exact: true })
    .click();
  await page.getByRole('button', { name: '选择候选人', exact: true }).first().click();
  await page
    .getByRole('dialog', { name: '选择候选人', exact: true })
    .getByRole('button', { name: '导入新的简历', exact: true })
    .click();
  const drawer = page.getByRole('dialog');
  await drawer.getByLabel('材料来源', { exact: true }).fill('本人投递');
  await drawer.getByLabel('简历文件', { exact: true }).setInputFiles(
    [firstItem, secondItem].map((item) => ({
      name: item.name,
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n% Fictional identity extraction fixture\n%%EOF'),
    })),
  );
  await drawer.getByRole('button', { name: '开始导入', exact: true }).click();
  await drawer.getByRole('button', { name: '核对与继续', exact: true }).first().click();
  const name = drawer.getByLabel('姓名（人工核对）', { exact: true });
  const phone = drawer.getByLabel('联系电话', { exact: true });
  const email = drawer.getByLabel('邮箱', { exact: true });
  await expect(name).toHaveValue('测试甲');
  await expect(phone).toHaveValue('13800000000');
  await expect(email).toHaveValue('test@example.com');
  await email.scrollIntoViewIfNeeded();
  await page.screenshot({ path: '../../.local/验收-简历自动填写.png' });
  await drawer.getByRole('button', { name: '查找疑似重复', exact: true }).click();
  await expect(
    drawer.getByRole('button', { name: '确认身份并进入应聘', exact: true }),
  ).toBeVisible();
  await name.fill('测试甲人工修订');
  await email.fill('');
  await drawer.getByRole('button', { name: '查找疑似重复', exact: true }).click();
  await expect(
    drawer.getByRole('alert').filter({ hasText: '虚构查重失败，请重新加载。' }),
  ).toBeVisible();
  useRefreshed = true;
  await drawer.getByRole('button', { name: '重新加载', exact: true }).click();
  await expect(name).toHaveValue('测试甲人工修订');
  await expect(phone).toHaveValue('13900000000');
  await expect(email).toHaveValue('');
  await expect(drawer.getByRole('button', { name: '确认身份并进入应聘', exact: true })).toHaveCount(
    0,
  );
  expect(confirmations).toHaveLength(0);
  await drawer.getByRole('button', { name: '查找疑似重复', exact: true }).click();
  await drawer.getByRole('button', { name: '确认身份并进入应聘', exact: true }).click();
  await expect(drawer.getByRole('button', { name: '打开本次应聘', exact: true })).toBeVisible();
  expect(matches).toHaveLength(3);
  expect(matches[2]).toMatchObject({
    parse: refreshedItem.parse?.id,
    display_name: '测试甲人工修订',
    phone: '13900000000',
    email: '',
  });
  expect(confirmations).toEqual([expect.objectContaining(matches[2])]);

  await drawer.getByRole('button', { name: '核对与继续', exact: true }).click();
  await expect(name).toHaveValue('测试乙');
  await expect(phone).toHaveValue('');
  await expect(email).toHaveValue('');
  await expect(drawer.getByText('识别到多个，请对照原文填写', { exact: true })).toHaveCount(2);
  await expect(name).not.toHaveValue('测试甲人工修订');
});
