import { expect, type Page, test } from '@playwright/test';
import { login } from './helpers';

async function post(page: Page, path: string, body: unknown) {
  const config = await (await page.request.get('/api/v1/auth/csrf/')).json();
  const response = await page.request.post(`/api/v1/${path}`, {
    data: body,
    headers: { 'X-CSRFToken': config.csrfToken },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

test('面试管理统一工作台筛选、导出和排期入口', async ({ page, browser }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page);
  const me = await (await page.request.get('/api/v1/me/')).json();
  let job = await post(page, 'jobs/', {
    request_id: crypto.randomUUID(),
    title: '面试工作台验收岗',
    location: '深圳',
    headcount: 1,
    department: me.departments[0].id,
    approver: me.departments[0].approvers[0].id,
  });
  job = await post(page, `jobs/${job.id}/profiles/`, {
    version: job.version,
    jd: '验证面试管理工作台。',
    source: '虚构验收需求',
    requirements: [{ kind: 'must', text: '完成一次结构化面试' }],
  });
  job = await post(page, `jobs/${job.id}/submit-profile/`, { version: job.version });
  const managerContext = await browser.newContext();
  const manager = await managerContext.newPage();
  await login(manager, 'local_manager');
  job = await post(manager, `jobs/${job.id}/review-profile/`, {
    version: job.version,
    outcome: 'confirm',
  });
  await managerContext.close();
  await post(page, `jobs/${job.id}/change-status/`, { version: job.version, status: 'open' });

  const entry = await post(page, 'candidates/', {
    request_key: crypto.randomUUID(),
    job: job.id,
    source: '其他',
    display_name: '面试工作台候选人',
    contact_note: '虚构验收记录',
    stage: 'ready_to_schedule',
  });
  const application = await (await page.request.get(`/api/v1/applications/${entry.application}/`)).json();
  await post(page, 'interviews/', {
    application: application.id,
    version: application.version,
    request_key: crypto.randomUUID(),
    round_no: 1,
    purpose: '验证面试管理工作台的真实排期数据。',
    starts_at: '2099-01-02T10:00:00+08:00',
    ends_at: '2099-01-02T11:00:00+08:00',
    timezone: 'Asia/Shanghai',
    mode: 'onsite',
    location: '深圳南山区会议室 A',
    meeting_url: '',
    participants: [me.departments[0].approvers[0].id],
  });

  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.getByRole('link', { name: '面试', exact: true }).click();
  await expect(page.getByText('面试安排与记录，一人可多轮', { exact: true })).toBeVisible();
  await expect(page.getByLabel('搜索面试记录')).toBeVisible();
  await expect(page.getByRole('button', { name: '导出本模块', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '新增面试记录', exact: true })).toBeVisible();
  await page.getByLabel('搜索面试记录').fill('面试工作台候选人');
  await expect(page.locator('table').getByText('面试工作台候选人', { exact: true })).toBeVisible();
  await page.locator('.interview-filter-select').nth(1).click();
  await page.screenshot({ path: 'test-results/面试管理筛选下拉.png', fullPage: true });
  await page
    .locator('.candidate-select-dropdown')
    .last()
    .getByText('现场面试', { exact: true })
    .click();
  await expect(page.locator('table').getByText('面试工作台候选人', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/面试管理工作台.png', fullPage: true });

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出本模块', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('面试管理.csv');
  await page.getByRole('button', { name: '新增面试记录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '候选人库', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
