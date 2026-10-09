import { expect, type Page, test } from '@playwright/test';

const personId = 99601;
const detailUrl = `/#candidate/${personId}`;
const originalResume = '姓名：虚构详情甲\n现居城市：厦门\n最高学历：本科\n原始简历材料。';
const attachment = {
  document: 99631,
  name: 'fictional-original.txt',
  download: true,
  is_current: true,
  parse: {
    id: 99641,
    version: 1,
    status: 'succeeded',
    text: originalResume,
    error: '',
    parser_version: 'fixture',
    actor_name: '虚构验收 HR',
  },
};
const replacement = {
  document: 99632,
  name: 'fictional-replacement.txt',
  download: true,
  is_current: true,
  parse: {
    ...attachment.parse,
    id: 99642,
    text: '姓名：附件里的另一名字\n现居城市：广州\n最高学历：博士\n替换后的虚构简历材料。',
  },
};

function candidate() {
  return {
    id: personId,
    display_name: '虚构详情甲',
    phone: '13800000961',
    email: 'candidate-detail@example.test',
    contact_note: '',
    gender: '女',
    current_city: '厦门',
    identity_number: '',
    birthday: '1998-09-28',
    intended_role: '测试工程师',
    education_level: '本科',
    school: '虚构学院',
    work_years: '4 年',
    current_salary: '12K',
    expected_salary: '15-18K',
    source: '猎聘',
    work_experience: '2022.06 至今 虚构科技公司 测试工程师',
    education_experience: '2018.09-2022.06 虚构学院 软件工程 本科',
    remarks: '原备注：仅限虚构验收',
    resume_text: originalResume,
    created_at: '2026-10-08T01:00:00Z',
    updated_at: '2026-10-10T01:00:00Z',
    can_edit_profile: true,
    can_delete: true,
    active_application_count: 2,
    applications: [
      {
        id: 99611,
        job_id: 99621,
        job__title: '虚构甲职位',
        attempt_no: 1,
        stage: 'pending_review',
        version: 2,
        closed_at: null as string | null,
        expected_start_date: null as string | null,
        offer_sent_at: null,
        hired_at: null,
      },
      {
        id: 99612,
        job_id: 99622,
        job__title: '虚构乙职位',
        attempt_no: 1,
        stage: 'ready_to_schedule',
        version: 4,
        closed_at: null as string | null,
        expected_start_date: '2026-11-01' as string | null,
        offer_sent_at: null,
        hired_at: null,
      },
    ],
    resume_documents: [structuredClone(attachment)],
    interview_count: 1,
    interview_records: [
      {
        id: 99651,
        application: 99612,
        candidate_name: '虚构详情甲',
        job_title: '虚构乙职位',
        round_no: 1,
        purpose: '虚构项目复盘面试',
        status: 'confirmed',
        organizer_name: '虚构验收 HR',
        invitation_status: 'not_sent',
        revision: {
          id: 99652,
          version: 1,
          starts_at: '2026-10-20T02:00:00Z',
          ends_at: '2026-10-20T03:00:00Z',
          timezone: 'Asia/Shanghai',
          mode: 'onsite',
          location: '虚构会议室',
          meeting_url: '',
          status: 'current',
          participants: [{ id: 99653, name: '虚构面试官', required: true, duty: 'interviewer' }],
        },
      },
    ],
    ai_screening_count: 1,
    ai_screenings: [
      {
        id: 99661,
        code: 'AIS-99661',
        created_at: '2026-10-09T02:00:00Z',
        candidate_name: '虚构详情甲',
        job_title: '虚构甲职位',
        enterprise_name: '',
        application_id: 99611,
        job_id: 99621,
        enterprise_id: null,
        summary: '虚构报告：材料提及自动化测试，需核实实际职责。',
        match_score: null,
        quality_version: 2,
        analysis_date: '2026-10-09',
        conclusion: '待复核',
        follow_up_direction: '核实测试样例与个人职责。',
        question_count: 2,
        questions_saved: false,
        saved_question_count: 0,
      },
    ],
  };
}
type EditPayload = {
  request_key: string;
  updated_at: string;
  fields: Record<string, string>;
  application?: {
    id?: number;
    version?: number;
    stage: string;
    expected_start_date: string | null;
  };
  job?: number | null;
  resume_document?: number;
  resume_parse?: number;
};

async function mockCandidateApi(page: Page, person = candidate()) {
  const state = {
    person,
    exists: true,
    detailStatus: 200,
    editFailure: 0,
    deleteFailure: 0,
    edits: [] as EditPayload[],
    deletions: [] as { updated_at: string }[],
    loads: 0,
    previews: 0,
    downloads: [] as string[],
    unexpected: [] as string[],
  };
  // 所有业务请求均拦截为虚构数据，不使用真实会话、数据库或附件。
  // 验证浏览器提交/展示契约；持久化、原子性和权限由后端独立测试验证。
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    if (method === 'GET') {
      if (path === '/api/v1/auth/csrf/')
        return route.fulfill({ json: { csrfToken: 'fictional-details-csrf', home_url: '/' } });
      if (path === '/api/v1/me/')
        return route.fulfill({
          json: {
            name: '虚构验收 HR',
            avatar_url: '',
            auth_source: 'local',
            organization: '虚构验收组织',
            roles: ['hr'],
            departments: [],
          },
        });
      if (path === '/api/v1/candidates/')
        return route.fulfill({
          json: {
            results: state.exists ? [state.person] : [],
            count: state.exists ? 1 : 0,
            next: null,
            previous: null,
          },
        });
      if (path === `/api/v1/candidates/${personId}/`) {
        state.loads += 1;
        return state.detailStatus === 200 && state.exists
          ? route.fulfill({ json: state.person })
          : route.fulfill({
              status: state.detailStatus === 200 ? 404 : state.detailStatus,
              json: { errors: { detail: '候选人不存在或你没有查看权限。' } },
            });
      }
      if (path === '/api/v1/applications/filter-options/')
        return route.fulfill({
          json: {
            jobs: state.person.applications.map((item) => ({
              job_id: item.job_id,
              job__title: item.job__title,
            })),
            sources: [],
          },
        });
      if (path === '/api/v1/jobs/')
        return route.fulfill({
          json: {
            results: [
              { id: 99621, title: '虚构甲职位', status: 'open', permissions: { edit: true } },
              { id: 99622, title: '虚构乙职位', status: 'open', permissions: { edit: true } },
              { id: 99623, title: '虚构丙职位', status: 'open', permissions: { edit: true } },
            ],
            count: 3,
            next: null,
            previous: null,
          },
        });
      if (/^\/api\/v1\/documents\/9963[12]\/download\/$/.test(path)) {
        state.downloads.push(request.url());
        return route.fulfill({
          contentType: 'text/plain; charset=utf-8',
          headers: { 'Content-Disposition': 'attachment; filename="fictional-resume.txt"' },
          body: path.includes('99632') ? replacement.parse.text : originalResume,
        });
      }
    }
    if (method === 'POST' && path === '/api/v1/candidates/preview-resume/') {
      state.previews += 1;
      expect(request.headers()['content-type']).toContain('multipart/form-data');
      return route.fulfill({ json: replacement });
    }
    if (method === 'POST' && path === `/api/v1/candidates/${personId}/edit/`) {
      const payload: EditPayload = request.postDataJSON();
      state.edits.push(payload);
      expect(request.headers()['x-csrftoken']).toBe('fictional-details-csrf');
      if (state.editFailure)
        return route.fulfill({
          status: state.editFailure,
          json: { errors: { detail: '保存失败，请保留输入并重试。' } },
        });
      Object.assign(state.person, payload.fields);
      state.person.updated_at = '2026-10-11T02:00:00Z';
      if (payload.application) {
        const selected = state.person.applications.find(
          (item) => item.id === payload.application?.id,
        );
        if (selected) {
          Object.assign(selected, payload.application, { version: selected.version + 1 });
        } else if (!payload.application.id && payload.job === 99623) {
          state.person.applications.push({
            id: 99613,
            job_id: 99623,
            job__title: '虚构丙职位',
            attempt_no: 1,
            stage: payload.application.stage,
            version: 1,
            closed_at: null,
            expected_start_date: payload.application.expected_start_date,
            offer_sent_at: null,
            hired_at: null,
          });
        } else throw new Error('必须指定当前候选人的应聘记录或新的目标职位');
      }
      if (payload.resume_document === replacement.document) {
        state.person.resume_documents.forEach((document) => {
          document.is_current = false;
        });
        state.person.resume_documents.push(structuredClone(replacement));
      }
      return route.fulfill({ json: state.person });
    }
    if (method === 'DELETE' && path === `/api/v1/candidates/${personId}/`) {
      state.deletions.push(request.postDataJSON());
      if (state.deleteFailure)
        return route.fulfill({
          status: state.deleteFailure,
          json: { errors: { detail: '候选人已有进行中的应聘，请刷新后处理。' } },
        });
      state.exists = false;
      return route.fulfill({ json: { deleted: true } });
    }
    state.unexpected.push(`${method} ${path}`);
    return route.fulfill({ status: 500, json: { errors: { detail: '未预期的验收请求' } } });
  });
  return state;
}

async function choose(page: Page, id: string, label: string) {
  await page.locator(id).click();
  await page
    .locator('.candidate-select-dropdown:visible')
    .getByRole('option')
    .filter({ hasText: label })
    .click();
}

test('列表三个操作进入独立详情，四个页签展示本人的记录及原始附件', async ({ page }) => {
  const state = await mockCandidateApi(page);
  await page.goto('/#candidates');
  const row = page.getByRole('row').filter({ hasText: state.person.display_name });
  for (const name of ['详情', '编辑', '删除'])
    await expect(row.getByRole('button', { name, exact: true })).toBeVisible();
  await row.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(page.locator('#edit-candidate-form')).toBeVisible();
  await expect(page.locator('#new-candidate-name')).toHaveValue(state.person.display_name);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await row.getByRole('button', { name: '详情', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#candidate/${personId}$`));
  const details = page.getByRole('region', { name: '候选人详情', exact: true });
  await expect(details.getByRole('heading', { name: '候选人详情', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  for (const name of ['基本信息', '面试记录（1）', 'AI 初面（1）', '简历原文'])
    await expect(details.getByRole('tab', { name, exact: true })).toBeVisible();
  for (const value of ['CAND-99601', '虚构乙职位', '厦门', '本科', '虚构学院', '猎聘', '15-18K'])
    await expect(details.locator('dl')).toContainText(value);
  await details.getByRole('tab', { name: '面试记录（1）' }).click();
  await expect(details.getByRole('tabpanel')).toContainText('虚构乙职位 · 第 1 轮面试');
  await expect(details.getByRole('tabpanel')).toContainText('虚构会议室');
  await expect(details.getByRole('tabpanel')).toContainText('已确认');
  await details.getByRole('tab', { name: 'AI 初面（1）' }).click();
  await expect(details.getByRole('tabpanel')).toContainText(state.person.ai_screenings[0].summary);
  await details.getByRole('tab', { name: '简历原文', exact: true }).click();
  await expect(details.locator('.candidate-resume-text')).toHaveText(originalResume);
  const view = details.getByRole('link', { name: '查看', exact: true });
  await expect(view).toHaveAttribute('href', '/api/v1/documents/99631/download/?inline=1');
  await expect(view).toHaveAttribute('target', '_blank');
  const downloading = page.waitForEvent('download');
  await details.getByRole('link', { name: '下载', exact: true }).click();
  const download = await downloading;
  expect(download.url()).toContain('/api/v1/documents/99631/download/');
  await page.reload();
  await expect(
    details.getByRole('heading', { name: state.person.display_name, exact: true }),
  ).toBeVisible();
  await expect(details.getByRole('tab', { name: '基本信息', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await details.getByRole('button', { name: '返回候选人库', exact: true }).click();
  await expect(page).toHaveURL(/#candidates$/);
  await expect(row).toBeVisible();
  expect(state.unexpected).toEqual([]);
});

test('编辑完整资料及所选应聘，失败保留输入，重试保存并可重新打开核对', async ({ page }) => {
  const state = await mockCandidateApi(page);
  await page.goto(detailUrl);
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  const form = page.locator('#edit-candidate-form');
  await expect(form).toBeVisible();
  const fields = {
    name: ['display_name', '虚构详情乙'],
    phone: ['phone', '13800000962'],
    email: ['email', 'edited-candidate@example.test'],
    city: ['current_city', '泉州'],
    'identity-number': ['identity_number', '11010519491231002X'],
    birthday: ['birthday', '1997-08-19'],
    'intended-role': ['intended_role', '质量工程师'],
    school: ['school', '虚构第二学院'],
    'work-years': ['work_years', '5 年'],
    'current-salary': ['current_salary', '14K'],
    'expected-salary': ['expected_salary', '18-20K'],
    'work-experience': ['work_experience', '2021 至今 虚构测试经历'],
    'education-experience': ['education_experience', '2017-2021 虚构教育经历'],
    remarks: ['remarks', '核对后的虚构备注'],
    'resume-text': ['resume_text', '人工核对后的简历原文'],
  };
  for (const [id, [, value]] of Object.entries(fields))
    await form.locator(`#new-candidate-${id}`).fill(value);
  await choose(page, '#new-candidate-gender', '男');
  await choose(page, '#new-candidate-education-level', '硕士');
  await choose(page, '#new-candidate-source', '智联招聘');
  await choose(page, '#new-candidate-job', '虚构甲职位 · 第 1 次应聘');
  await choose(page, '#new-candidate-stage', '人才库');
  await form.getByRole('button', { name: '选择预计入职日期' }).click();
  await page.getByRole('button', { name: '选择今天', exact: true }).click();
  const expectedDate = await form.locator('#new-candidate-expected-start').innerText();
  state.editFailure = 503;
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(form.getByRole('alert')).toBeVisible();
  await expect(form.locator('#new-candidate-name')).toHaveValue('虚构详情乙');
  expect(state.person.display_name).toBe('虚构详情甲');
  state.editFailure = 0;
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(form).toHaveCount(0);
  await expect(page.locator('.candidate-detail-fields')).toContainText('虚构第二学院');
  expect(state.edits).toHaveLength(2);
  expect(state.edits[0].request_key).toBe(state.edits[1].request_key);
  expect(state.edits[1]).toMatchObject({
    updated_at: '2026-10-10T01:00:00Z',
    fields: {
      ...Object.fromEntries(Object.values(fields)),
      gender: '男',
      education_level: '硕士',
      source: '智联招聘',
    },
    application: {
      id: 99611,
      version: 2,
      stage: 'talent_pool',
      expected_start_date: expectedDate.trim(),
    },
  });
  expect(state.person.applications[1]).toMatchObject({
    id: 99612,
    stage: 'ready_to_schedule',
    version: 4,
  });
  await page.reload();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(form.locator('#new-candidate-name')).toHaveValue('虚构详情乙');
  await expect(form.locator('#new-candidate-resume-text')).toHaveValue('人工核对后的简历原文');
  expect(state.unexpected).toEqual([]);
});

test('编辑重传附件保留人工资料，状态只更新所选应聘，删除成功返回列表', async ({ page }) => {
  const state = await mockCandidateApi(page);
  await page.goto(detailUrl);
  await choose(page, '.candidate-detail-application', '虚构甲职位 · 第 1 次应聘');
  await choose(page, '.candidate-detail-stage', '已淘汰');
  await expect(page.getByText('当前应聘状态已更新。', { exact: true })).toBeVisible();
  expect(state.edits[0].application).toMatchObject({ id: 99611, version: 2, stage: 'closed' });
  expect(state.person.applications[1].stage).toBe('ready_to_schedule');
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  const form = page.locator('#edit-candidate-form');
  await expect(form.getByRole('button', { name: '重新上传', exact: true })).toBeVisible();
  await form.locator('.candidate-resume-input').setInputFiles({
    name: replacement.name,
    mimeType: 'text/plain',
    buffer: Buffer.from(replacement.parse.text),
  });
  await expect(form.getByRole('status')).toContainText(replacement.name);
  await expect(form.locator('#new-candidate-name')).toHaveValue('虚构详情甲');
  await expect(form.locator('#new-candidate-city')).toHaveValue('厦门');
  await expect(form.locator('#new-candidate-resume-text')).toHaveValue(replacement.parse.text);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(form).toHaveCount(0);
  expect(state.previews).toBe(1);
  expect(state.edits[1]).toMatchObject({ resume_document: 99632, resume_parse: 99642 });
  await page.getByRole('tab', { name: '简历原文', exact: true }).click();
  await expect(page.locator('.candidate-detail-resume')).toContainText(attachment.name);
  await expect(page.locator('.candidate-detail-resume')).toContainText(replacement.name);
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(form.locator('.candidate-edit-attachment')).toContainText(replacement.name);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  // 仍有活跃应聘时不会发出删除请求。
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await expect(page.getByRole('button', { name: '确认删除', exact: true })).toBeDisabled();
  expect(state.deletions).toHaveLength(0);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  state.person.active_application_count = 0;
  state.person.applications.forEach((item) => {
    item.closed_at = '2026-10-11T02:00:00Z';
  });
  await page.reload();
  await page.getByRole('button', { name: '删除', exact: true }).click();
  state.deleteFailure = 409;
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`#candidate/${personId}$`));
  state.deleteFailure = 0;
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(page).toHaveURL(/#candidates$/);
  await expect(page.getByRole('row').filter({ hasText: '虚构详情甲' })).toHaveCount(0);
  expect(state.deletions).toHaveLength(2);
  expect(state.unexpected).toEqual([]);
});

test('编辑切换已有应聘或新增职位，保存后详情立即显示本次保存的职位和状态', async ({ page }) => {
  const state = await mockCandidateApi(page);
  await page.goto(detailUrl);
  await expect(page.locator('.candidate-detail-application')).toContainText('虚构乙职位');
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await choose(page, '#new-candidate-job', '虚构甲职位 · 第 1 次应聘');
  await choose(page, '#new-candidate-stage', '初试通过');
  await expect(page.locator('#new-candidate-stage')).toContainText('初试通过');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('#edit-candidate-form')).toHaveCount(0);
  await expect(page.locator('.candidate-detail-application')).toContainText('虚构甲职位');
  await expect(page.locator('.candidate-detail-stage')).toContainText('初试通过');
  await expect(page.locator('.candidate-detail-fields')).toContainText('虚构甲职位');
  expect(state.person.applications[1].stage).toBe('ready_to_schedule');

  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await choose(page, '#new-candidate-job', '虚构丙职位');
  await choose(page, '#new-candidate-stage', '待复试');
  await expect(page.locator('#new-candidate-stage')).toContainText('待复试');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('#edit-candidate-form')).toHaveCount(0);
  await expect(page.locator('.candidate-detail-application')).toContainText('虚构丙职位');
  await expect(page.locator('.candidate-detail-stage')).toContainText('待复试');
  await expect(page.locator('.candidate-detail-fields')).toContainText('虚构丙职位');
  expect(state.person.applications).toHaveLength(3);
  expect(state.person.applications[0].stage).toBe('first_interview_passed');
  expect(state.person.applications[1].stage).toBe('ready_to_schedule');
  expect(state.unexpected).toEqual([]);
});

test('空记录、无下载与编辑权限及详情加载失败均给出实际状态', async ({ page }) => {
  const person = candidate();
  person.applications = [];
  person.interview_records = [];
  person.interview_count = 0;
  person.ai_screenings = [];
  person.ai_screening_count = 0;
  person.can_edit_profile = false;
  person.can_delete = false;
  person.resume_documents[0].download = false;
  const state = await mockCandidateApi(page, person);
  state.detailStatus = 404;
  await page.goto(detailUrl);
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('heading', { name: person.display_name, exact: true })).toHaveCount(
    0,
  );
  state.detailStatus = 200;
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await expect(page.getByRole('heading', { name: person.display_name, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '编辑', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '删除', exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: '面试记录（0）' }).click();
  await expect(page.getByText('暂无面试记录', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'AI 初面（0）' }).click();
  await expect(page.getByText('暂无 AI 初面记录', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '简历原文', exact: true }).click();
  await expect(page.locator('.candidate-detail-resume')).toContainText(attachment.name);
  await expect(page.getByRole('link', { name: '下载', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '查看', exact: true })).toHaveCount(0);
  expect(state.unexpected).toEqual([]);
});
