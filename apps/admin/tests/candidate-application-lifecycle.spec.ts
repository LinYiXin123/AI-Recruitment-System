import { expect, type Page, test } from '@playwright/test';

const job = {
  id: 99301,
  title: '虚构恢复验收岗位',
  department_name: '虚构测试部门',
  location: '深圳',
  status: 'open',
  active_profile: 99311,
  active_profile_number: 1,
  latest_profile: { id: 99311 },
  owner_name: '虚构验收 HR',
  permissions: { edit: true, confirm: false },
};

async function openRemovedApplication(page: Page, canRestore = true) {
  const application = {
    id: 99321,
    candidate: 99331,
    name: '虚构已移出候选人',
    job: job.id,
    job_title: job.title,
    job_status: 'open',
    attempt_no: 1,
    stage: 'pending_review',
    closed_at: null,
    version: 1,
    source: '其他',
    owner_name: '虚构验收 HR',
    phone: '',
    email: '',
    contact_note: '虚构验收资料',
    close_reason: '',
    profile: 99311,
    requirements: [],
    handlers: [],
    interviewers: [],
    resumes: [],
    reviews: [],
    candidate_deleted_at: '2026-10-09T02:00:00Z' as string | null,
    candidate_updated_at: '2026-10-09T02:00:00Z',
    can_restore_candidate: canRestore,
  };
  const state = {
    application,
    restores: [] as unknown[],
    failRestore: false,
    applicationLoads: 0,
    requestedJobs: [] as string[],
    unexpected: [] as string[],
  };
  // 仅验证界面与接口契约，所有数据均在测试中构造，不访问真实候选人。
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === '/api/v1/auth/csrf/')
      return route.fulfill({ json: { csrfToken: 'candidate-restore-csrf', home_url: '/' } });
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
    if (path === '/api/v1/jobs/')
      return route.fulfill({ json: { count: 1, next: null, previous: null, results: [job] } });
    if (path === `/api/v1/jobs/${job.id}/`) return route.fulfill({ json: job });
    if (path === '/api/v1/applications/filter-options/')
      return route.fulfill({ json: { jobs: [{ job_id: job.id, job__title: job.title }] } });
    if (path === '/api/v1/applications/') {
      state.requestedJobs.push(url.searchParams.get('job') || '');
      return route.fulfill({
        json: { count: 1, next: null, previous: null, results: [state.application] },
      });
    }
    if (path === `/api/v1/applications/${application.id}/`) {
      state.applicationLoads += 1;
      return route.fulfill({ json: state.application });
    }
    if (path === `/api/v1/candidates/${application.candidate}/restore/`) {
      expect(request.method()).toBe('POST');
      expect(request.headers()['x-csrftoken']).toBe('candidate-restore-csrf');
      state.restores.push(request.postDataJSON());
      if (state.failRestore)
        return route.fulfill({
          status: 503,
          json: { errors: { detail: '恢复失败，请稍后重试。' } },
        });
      state.application = {
        ...state.application,
        candidate_deleted_at: null,
        candidate_updated_at: '2026-10-09T03:00:00Z',
        can_restore_candidate: false,
      };
      return route.fulfill({ json: { restored: true } });
    }
    if (path === '/api/v1/candidates/') {
      const results = state.application.candidate_deleted_at
        ? []
        : [
            {
              id: application.candidate,
              display_name: application.name,
              source: '其他',
              applications: [
                {
                  id: application.id,
                  job_id: job.id,
                  job__title: job.title,
                  attempt_no: 1,
                  stage: 'pending_review',
                  closed_at: null,
                },
              ],
              can_delete: true,
              active_application_count: 1,
              updated_at: state.application.candidate_updated_at,
            },
          ];
      return route.fulfill({
        json: { count: results.length, next: null, previous: null, results },
      });
    }
    state.unexpected.push(`${request.method()} ${path}`);
    return route.fulfill({ status: 500, json: { errors: { detail: '未预期的验收请求' } } });
  });
  await page.goto('/#talent-profiles');
  const jobRow = page.getByRole('row').filter({ hasText: job.title });
  await expect(jobRow.getByRole('button', { name: '查看候选人', exact: true })).toHaveCount(0);
  await jobRow.getByRole('button', { name: '查看本职位应聘', exact: true }).click();
  await expect(page.getByRole('tab', { name: '简历对照', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const row = page.getByRole('row', { includeHidden: true }).filter({ hasText: application.name });
  await expect(row).toContainText('已移出候选人库');
  await expect(row).toContainText('原应聘待处理');
  expect(state.requestedJobs).toContain(String(job.id));
  await row.getByRole('button', { name: application.name, exact: true }).click();
  const detail = page.getByRole('dialog', {
    name: `${application.name} · 第 1 次应聘`,
    exact: true,
  });
  await expect(detail).toBeVisible();
  await expect(detail).toContainText('已移出候选人库');
  return { state, detail, row };
}

test('已移出记录仍显示原应聘，恢复失败不改状态，重试后刷新应聘和候选人库', async ({ page }) => {
  const { state, detail, row } = await openRemovedApplication(page);
  const updatedAt = state.application.candidate_updated_at;
  state.failRestore = true;
  const restore = detail.getByRole('button', { name: '恢复到候选人库', exact: true });
  await expect(restore).toBeVisible();
  expect(state.restores).toHaveLength(0);
  await restore.click();
  await expect(detail.getByRole('alert').filter({ hasText: '恢复失败' })).toContainText(
    '恢复失败，请稍后重试。',
  );
  await expect(row).toContainText('已移出候选人库');
  await expect(restore).toBeEnabled();
  state.failRestore = false;
  const previousLoads = state.applicationLoads;
  await restore.click();
  await expect(detail).toContainText('已恢复到候选人库，原有应聘和材料保持不变。');
  await expect(restore).toHaveCount(0);
  await expect(row).not.toContainText('已移出候选人库');
  await expect(row).not.toContainText('原应聘待处理');
  expect(state.applicationLoads).toBeGreaterThan(previousLoads);
  expect(state.restores).toEqual([{ updated_at: updatedAt }, { updated_at: updatedAt }]);
  await page.getByRole('button', { name: '关闭详情', exact: true }).click();
  await page.getByRole('link', { name: '候选人', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: state.application.name })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('row').filter({ hasText: state.application.name })).toBeVisible();
  expect(state.unexpected).toEqual([]);
});

test('无恢复权限的已移出应聘只显示状态，不显示恢复按钮', async ({ page }) => {
  const { state, detail } = await openRemovedApplication(page, false);
  await expect(detail.getByRole('button', { name: '恢复到候选人库', exact: true })).toHaveCount(0);
  expect(state.restores).toHaveLength(0);
  expect(state.unexpected).toEqual([]);
});
