import { expect, type Page, test } from '@playwright/test';
import { login } from './helpers';

async function post(page: Page, path: string, body: unknown) {
  const csrf = await (await page.request.get('/api/v1/auth/csrf/')).json();
  const response = await page.request.post(`/api/v1/${path}`, {
    data: body,
    headers: { 'X-CSRFToken': csrf.csrfToken },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

async function openJob(page: Page, title: string) {
  const me = await (await page.request.get('/api/v1/me/')).json();
  let job = await post(page, 'jobs/', {
    request_id: crypto.randomUUID(),
    title,
    location: '深圳',
    headcount: 1,
    department: me.departments[0].id,
    approver: me.departments[0].approvers[0].id,
  });
  job = await post(page, `jobs/${job.id}/profiles/`, {
    version: job.version,
    jd: '负责虚构验收项目的用户访谈',
    source: '虚构验收标准',
    activate: true,
    requirements: [{ kind: 'must', text: '具备访谈经验' }],
  });
  return post(page, `jobs/${job.id}/change-status/`, { version: job.version, status: 'open' });
}

async function selectSource(page: Page, id: string, source: string) {
  await page.locator(id).click();
  await page
    .locator('.candidate-select-dropdown:visible')
    .getByText(source, { exact: true })
    .click();
}

const file = {
  name: 'fictional-profile.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.4\nFictional fixture requiring manual transcription.'),
};

test('旧导入入口核对八项简历资料，来源可选择或留空并平铺保存', async ({ page }) => {
  test.setTimeout(90000);
  await login(page);
  const job = await openJob(page, '虚构资料入库验收岗');
  await page.getByRole('link', { name: '人才画像', exact: true }).click();
  await page.getByRole('tab', { name: '简历对照', exact: true }).click();
  await page.getByRole('button', { name: '选择候选人', exact: true }).first().click();
  await page.getByRole('dialog').getByLabel('目标职位', { exact: true }).click();
  await page.getByRole('option').filter({ hasText: job.title }).click();
  await page.getByRole('button', { name: '导入新的简历', exact: true }).click();
  await expect(page.getByLabel('材料来源', { exact: true })).toHaveCount(0);
  await page.getByLabel('简历文件', { exact: true }).setInputFiles(file);
  await page.getByRole('button', { name: '开始导入', exact: true }).click();
  await expect(page.getByText('已接收 1 / 1 份，已核对 0 份')).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: '核对与继续', exact: true }).click();
  await page.getByLabel('人工摘录（请写明页码或来源）').fill(`姓名：虚构资料甲
邮箱：candidate-profile-first@example.com
现居城市：厦门
最高学历：本科
毕业院校：虚构学院
工作年限：4 年
意向岗位：测试工程师
当前薪资：9K
期望薪资：12-15K
简历来源：BOSS直聘
摘录来源：虚构 PDF 第 1 页`);
  await page.getByRole('button', { name: '保存人工摘录版本', exact: true }).click();
  await expect(page.getByLabel('姓名', { exact: true })).toHaveValue('虚构资料甲');
  await page.getByText('简历资料（核对学历、城市、薪资和来源）', { exact: true }).click();
  const profile = {
    current_city: '厦门',
    education_level: '本科',
    school: '虚构学院',
    work_years: '4 年',
    intended_role: '测试工程师',
    current_salary: '9K',
    expected_salary: '12-15K',
    source: '',
  };
  for (const [field, value] of Object.entries(profile)) {
    if (field !== 'education_level' && field !== 'source')
      await expect(page.locator(`#import-profile-${field}`)).toHaveValue(value);
  }
  await expect(page.locator('#import-profile-education_level')).toContainText('本科');
  await expect(page.locator('#import-profile-source')).toContainText('BOSS直聘');
  for (const source of ['猎聘', '智联招聘', 'BOSS直聘', '未标注']) {
    await selectSource(page, '#import-profile-source', source);
    await expect(page.locator('#import-profile-source')).toContainText(source);
  }
  await page.getByRole('button', { name: '查找疑似重复', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('在可查看的候选人中未发现重复。');
  const saved = page.waitForResponse('**/items/*/confirm/');
  await page.getByRole('button', { name: '新建候选人并加入职位', exact: true }).click();
  const response = await saved;
  expect(response.ok(), await response.text()).toBeTruthy();
  expect(response.request().postDataJSON()).toMatchObject(profile);
  expect(response.request().postDataJSON()).not.toHaveProperty('profile');
  const item = await response.json();
  const application = await (
    await page.request.get(`/api/v1/applications/${item.application}/`)
  ).json();
  const person = await (
    await page.request.get(`/api/v1/candidates/${application.candidate}/`)
  ).json();
  expect(person).toMatchObject({ display_name: '虚构资料甲', ...profile });
  await expect(page.getByText('已接收 1 / 1 份，已核对 1 份')).toBeVisible();
});

test('遗留档案在编辑表单补齐资料，保存后刷新及来源筛选生效', async ({ page }) => {
  test.setTimeout(90000);
  await login(page);
  const job = await openJob(page, '虚构遗留资料验收岗');
  const batch = await post(page, 'imports/', {
    request_key: crypto.randomUUID(),
    job: job.id,
    source: '',
    total: 1,
  });
  const csrf = await (await page.request.get('/api/v1/auth/csrf/')).json();
  const uploaded = await page.request.post(`/api/v1/imports/${batch.id}/upload/`, {
    headers: { 'X-CSRFToken': csrf.csrfToken },
    multipart: { request_key: crypto.randomUUID(), file },
  });
  expect(uploaded.ok(), await uploaded.text()).toBeTruthy();
  const item = await uploaded.json();
  const parsed = await post(page, `imports/${batch.id}/items/${item.id}/parse/`, {
    request_key: crypto.randomUUID(),
    text: `姓名：虚构遗留乙
邮箱：candidate-profile-legacy@example.com
求职意向：产品专员
教育经历
2018.09-2022.06 虚构学院
软件工程 | 本科
项目经历
虚构验收项目`,
  });
  // 按旧接口调用方式只提交身份信息，保留有简历文字但缺少资料字段的历史状态。
  const confirmed = await post(page, `imports/${batch.id}/items/${item.id}/confirm/`, {
    parse: parsed.parse.id,
    display_name: '虚构遗留乙',
    email: 'candidate-profile-legacy@example.com',
  });
  const application = await (
    await page.request.get(`/api/v1/applications/${confirmed.application}/`)
  ).json();
  const path = `/api/v1/candidates/${application.candidate}/`;
  const before = await (await page.request.get(path)).json();
  const emptyFields = {
    current_city: '',
    education_level: '',
    school: '',
    work_years: '',
    intended_role: '',
    current_salary: '',
    expected_salary: '',
    source: '',
  };
  expect(before).toMatchObject(emptyFields);
  expect(before.resume_documents[0].parse.id).toBe(parsed.parse.id);
  await page.getByRole('link', { name: '候选人', exact: true }).click();
  await page.getByLabel('搜索候选人').fill('虚构遗留乙');
  const row = page.getByRole('row').filter({ hasText: '虚构遗留乙' });
  await row.getByRole('button', { name: '详情', exact: true }).click();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(page.locator('#edit-candidate-form')).toBeVisible();
  for (const field of [
    'city',
    'school',
    'intended-role',
    'work-years',
    'current-salary',
    'expected-salary',
  ])
    await expect(page.locator(`#new-candidate-${field}`)).toHaveValue('');
  await selectSource(page, '#new-candidate-education-level', '本科');
  await page.locator('#new-candidate-school').fill('虚构学院');
  await page.locator('#new-candidate-intended-role').fill('产品专员');
  expect(await (await page.request.get(path)).json()).toMatchObject({
    ...emptyFields,
    updated_at: before.updated_at,
  });
  await selectSource(page, '#new-candidate-source', '猎聘');
  expect(await (await page.request.get(path)).json()).toMatchObject({
    ...emptyFields,
    updated_at: before.updated_at,
  });
  const saved = page.waitForResponse(`**/candidates/${before.id}/edit/`);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const response = await saved;
  expect(response.ok(), await response.text()).toBeTruthy();
  const fields = {
    education_level: '本科',
    school: '虚构学院',
    intended_role: '产品专员',
    source: '猎聘',
  };
  expect(response.request().postDataJSON()).toMatchObject({
    updated_at: before.updated_at,
    fields,
  });
  await expect(page.getByText('候选人已保存。', { exact: true })).toBeVisible();
  await expect(page.locator('#edit-candidate-form')).toHaveCount(0);
  await page.getByRole('button', { name: '返回候选人库', exact: true }).click();
  await page.reload();
  await page.getByLabel('搜索候选人').fill('虚构遗留乙');
  const sourceFilter = page.locator('.candidate-filter-select').nth(1);
  for (const [source, count] of [
    ['猎聘', 1],
    ['BOSS直聘', 0],
    ['猎聘', 1],
  ] as const) {
    await sourceFilter.click();
    await page
      .locator('.candidate-select-dropdown:visible')
      .getByText(source, { exact: true })
      .click();
    await expect(row).toHaveCount(count);
  }
  await expect(row).toContainText('本科');
  await expect(row).toContainText('猎聘');
  const after = await (await page.request.get(path)).json();
  expect(after).toMatchObject({ ...emptyFields, ...fields });
  expect(after.updated_at).not.toBe(before.updated_at);
  await row.getByRole('button', { name: '详情', exact: true }).click();
  await expect(page.locator('.candidate-detail-fields')).toContainText('虚构学院');
  await expect(page.locator('.candidate-detail-fields')).toContainText('产品专员');
});

test('候选人详情把个人画像和岗位对照分开，并按当前简历整理', async ({ page }) => {
  test.setTimeout(90000);
  await login(page);
  const job = await openJob(page, '虚构人才画像验收岗');
  const batch = await post(page, 'imports/', {
    request_key: crypto.randomUUID(),
    job: job.id,
    source: '',
    total: 1,
  });
  const csrf = await (await page.request.get('/api/v1/auth/csrf/')).json();
  const uploaded = await page.request.post(`/api/v1/imports/${batch.id}/upload/`, {
    headers: { 'X-CSRFToken': csrf.csrfToken },
    multipart: { request_key: crypto.randomUUID(), file },
  });
  expect(uploaded.ok(), await uploaded.text()).toBeTruthy();
  const item = await uploaded.json();
  const parsed = await post(page, `imports/${batch.id}/items/${item.id}/parse/`, {
    request_key: crypto.randomUUID(),
    text: '姓名：虚构画像候选人\n邮箱：portrait@example.test\n意向：产品交付\n负责产品上线，整理用户反馈。',
  });
  const confirmed = await post(page, `imports/${batch.id}/items/${item.id}/confirm/`, {
    parse: parsed.parse.id,
    display_name: '虚构画像候选人',
    email: 'portrait@example.test',
  });
  const application = await (
    await page.request.get(`/api/v1/applications/${confirmed.application}/`)
  ).json();
  const candidateId = application.candidate;
  let generatedProfile: Record<string, unknown> | null = null;

  await page.route(`**/api/v1/candidates/${candidateId}/`, async (route) => {
    const response = await route.fetch();
    const detail = await response.json();
    if (generatedProfile) detail.talent_profile_analysis = generatedProfile;
    await route.fulfill({ response, body: JSON.stringify(detail) });
  });
  await page.route('**/api/v1/ai-screenings/', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const input = route.request().postDataJSON();
    expect(input).toMatchObject({ candidate_id: candidateId, resume_parse_id: parsed.parse.id });
    expect(input).not.toHaveProperty('application_id');
    expect(input).not.toHaveProperty('job_id');
    generatedProfile = {
      id: 1,
      created_at: new Date().toISOString(),
      summary: '简历提到产品上线与用户反馈整理，具体职责还可面试核实。',
      resume_parse_id: parsed.parse.id,
      source_is_current: true,
      source_context: { source: { filename: item.name, parse_version: parsed.parse.version } },
      evidence: [
        {
          criterion: '产品交付',
          quote: '负责产品上线',
          reason: '简历文字提到上线工作，实际承担范围需核实。',
        },
      ],
      gaps: [],
      questions: [],
    };
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.getByRole('link', { name: '候选人', exact: true }).click();
  await page.getByLabel('搜索候选人').fill('虚构画像候选人');
  const row = page.getByRole('row').filter({ hasText: '虚构画像候选人' });
  await row.getByRole('button', { name: '详情', exact: true }).click();
  await page.getByRole('tab', { name: '人才画像', exact: true }).click();
  await page.getByRole('button', { name: 'AI 整理人才画像', exact: true }).click();
  await expect(
    page.getByText('简历提到产品上线与用户反馈整理，具体职责还可面试核实。'),
  ).toBeVisible();
  await expect(page.getByText('每个岗位的匹配情况在对应应聘记录中查看。')).toBeVisible();
});
