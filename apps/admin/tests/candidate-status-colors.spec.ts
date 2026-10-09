import { expect, test } from '@playwright/test';

test('候选人和人才画像的全部应聘状态在列表与详情同色，已移出为红色且未知状态中性', async ({
  page,
}) => {
  const colors = {
    blue: 'rgb(36, 86, 184)',
    orange: 'rgb(148, 98, 0)',
    green: 'rgb(22, 104, 71)',
    red: 'rgb(180, 35, 50)',
    neutral: 'rgb(100, 116, 139)',
  };
  // 独立记录产品口径，避免测试和生产代码共同读取同一映射而漏掉错误。
  const cases = [
    { stage: 'pending_review', label: '待筛选', color: colors.blue },
    { stage: 'needs_information', label: '待补充', color: colors.orange },
    { stage: 'ready_to_schedule', label: '待初试', color: colors.blue },
    { stage: 'interviewing', label: '面试中', color: colors.blue },
    { stage: 'first_interview_passed', label: '初试通过', color: colors.green },
    { stage: 'second_interview', label: '待复试', color: colors.blue },
    { stage: 'second_interview_passed', label: '复试通过', color: colors.green },
    { stage: 'offer_sent', label: '已发offer', color: colors.blue },
    { stage: 'hired', label: '已入职', color: colors.green },
    { stage: 'closed', label: '已淘汰', color: colors.red },
    { stage: 'talent_pool', label: '人才库', color: colors.neutral },
    { stage: 'future_stage', label: 'future_stage', color: colors.neutral },
  ];
  const applications = cases.map((item, index) => ({
    id: 99511 + index,
    candidate: 99501,
    name: '虚构全状态人选',
    job: 99601 + index,
    job_title: `虚构状态验收职位${index + 1}`,
    job_status: 'open',
    attempt_no: 1,
    stage: item.stage,
    closed_at: ['closed', 'hired', 'talent_pool'].includes(item.stage)
      ? '2026-10-09T05:00:00Z'
      : null,
    version: 1,
    source: '',
    owner_name: '虚构颜色验收 HR',
    owner_avatar_url: '',
    owner_chat_url: '',
    phone: '',
    email: '',
    contact_note: '仅用于虚构界面验收',
    close_reason: '',
    profile: 99701 + index,
    requirements: [],
    handlers: [],
    interviewers: [],
    resumes: [],
    reviews: [],
    profile_analysis: null,
    candidate_deleted_at: null as string | null,
    candidate_updated_at: '2026-10-09T05:00:00Z',
    can_restore_candidate: false,
  }));
  const removed = {
    ...applications[9],
    id: 99599,
    candidate: 99598,
    name: '虚构已移出人选',
    candidate_deleted_at: '2026-10-09T06:00:00Z',
  };
  const candidate = {
    id: 99501,
    display_name: applications[0].name,
    phone: '',
    email: '',
    source: '',
    can_delete: false,
    can_edit_profile: false,
    updated_at: '2026-10-09T05:00:00Z',
    resume_documents: [],
    applications: applications.map((application) => ({
      id: application.id,
      job_id: application.job,
      job__title: application.job_title,
      attempt_no: application.attempt_no,
      stage: application.stage,
      closed_at: application.closed_at,
    })),
  };
  const jobs = applications.map((application) => ({
    id: application.job,
    title: application.job_title,
    status: 'open',
    owner_name: application.owner_name,
    owner_avatar_url: '',
    owner_chat_url: '',
    active_profile: application.profile,
    active_profile_number: 1,
    latest_profile: { id: application.profile },
    permissions: { edit: false, confirm: false },
  }));
  const unexpected: string[] = [];
  // 全部业务接口均使用虚构资料，既不读取实际候选人，也不改变应聘状态。
  await page.route('**/api/v1/**', (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET') {
      if (path === '/api/v1/auth/csrf/')
        return route.fulfill({ json: { csrfToken: 'fictional-status-csrf', home_url: '/' } });
      if (path === '/api/v1/me/')
        return route.fulfill({
          json: {
            name: '虚构颜色验收 HR',
            avatar_url: '',
            auth_source: 'local',
            organization: '虚构验收组织',
            roles: ['hr'],
            departments: [],
          },
        });
      if (path === '/api/v1/candidates/')
        return route.fulfill({
          json: { count: 1, next: null, previous: null, results: [candidate] },
        });
      if (path === `/api/v1/candidates/${candidate.id}/`) return route.fulfill({ json: candidate });
      if (path === '/api/v1/jobs/')
        return route.fulfill({
          json: { count: jobs.length, next: null, previous: null, results: jobs },
        });
      if (path === '/api/v1/applications/filter-options/')
        return route.fulfill({
          json: {
            jobs: jobs.map((job) => ({ job_id: job.id, job__title: job.title })),
            sources: [],
          },
        });
      if (path === '/api/v1/applications/')
        return route.fulfill({
          json: {
            count: applications.length + 1,
            next: null,
            previous: null,
            results: [...applications, removed],
          },
        });
      const application = applications.find((item) => path === `/api/v1/applications/${item.id}/`);
      if (application) return route.fulfill({ json: application });
    }
    unexpected.push(`${request.method()} ${path}`);
    return route.fulfill({ status: 500, json: { errors: { detail: '未预期的验收请求' } } });
  });

  await page.goto('/#candidates');
  const candidateRow = page.getByRole('row').filter({ hasText: candidate.display_name });
  const backgrounds: string[] = [];
  for (const item of cases) {
    const badge = candidateRow.locator('[data-slot="badge"]').filter({ hasText: item.label });
    await expect(badge).toHaveText(item.label);
    await expect(badge).toHaveCSS('color', item.color);
    backgrounds.push(await badge.evaluate((element) => getComputedStyle(element).backgroundColor));
  }
  await candidateRow.getByRole('button', { name: '详情', exact: true }).click();
  const candidateDetail = page.getByRole('region', { name: '候选人详情', exact: true });
  for (const [index, item] of cases.entries()) {
    await candidateDetail.locator('.candidate-detail-application').click();
    await page
      .locator('.candidate-select-dropdown:visible')
      .getByText(`${applications[index].job_title} · 第 ${applications[index].attempt_no} 次应聘`, {
        exact: true,
      })
      .click();
    const badge = candidateDetail.locator('[data-slot="badge"]').filter({ hasText: item.label });
    await expect(badge).toHaveText(item.label);
    await expect(badge).toHaveCSS('color', item.color);
    await expect(badge).toHaveCSS('background-color', backgrounds[index]);
  }
  await candidateDetail.getByRole('button', { name: '返回候选人库', exact: true }).click();
  await page.getByRole('link', { name: '人才画像', exact: true }).click();
  await page.getByRole('tab', { name: '简历对照', exact: true }).click();
  for (const [index, item] of cases.entries()) {
    const application = applications[index];
    const row = page.getByRole('row').filter({
      has: page.getByText(application.job_title, { exact: true }),
      hasText: candidate.display_name,
    });
    const badge = row.locator('[data-slot="badge"]').filter({ hasText: item.label });
    await expect(badge).toHaveText(item.label);
    await expect(badge).toHaveCSS('color', item.color);
    await expect(badge).toHaveCSS('background-color', backgrounds[index]);
    await row.getByRole('button', { name: '查看简历并对照', exact: true }).click();
    const detail = page.getByRole('dialog', {
      name: `${application.name} · 第 1 次应聘`,
      exact: true,
    });
    await expect(
      detail.getByRole('heading', { name: application.job_title, exact: true }),
    ).toBeVisible();
    const detailBadge = detail.locator('[data-slot="badge"]').filter({ hasText: item.label });
    await expect(detailBadge).toHaveText(item.label);
    await expect(detailBadge).toHaveCSS('color', item.color);
    await expect(detailBadge).toHaveCSS('background-color', backgrounds[index]);
    await detail.getByRole('button', { name: '关闭详情', exact: true }).click();
  }
  const removedRow = page.getByRole('row').filter({ hasText: removed.name });
  await expect(page.getByText('这里显示职位应聘记录', { exact: false })).toHaveCount(0);
  await expect(
    removedRow.locator('[data-slot="badge"]').filter({ hasText: '已移出候选人库' }),
  ).toHaveCSS('color', colors.red);
  expect(unexpected).toEqual([]);
});
