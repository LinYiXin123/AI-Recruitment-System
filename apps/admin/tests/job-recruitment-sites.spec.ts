import { readFile } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';
import type { Job } from '../src/lib/api';
import { login } from './helpers';

const websites = ['BOSS直聘', '猎聘', '智联招聘', '前程无忧', '拉勾招聘', '其他'];

async function openJobs(page: Page, title: string) {
  await page.getByRole('link', { name: '职位', exact: true }).click();
  await page.getByLabel('搜索职位或地点', { exact: true }).fill(title);
}

async function postJob(page: Page, path: string, data: unknown): Promise<Job> {
  const csrf = await (await page.request.get('/api/v1/auth/csrf/')).json();
  const response = await page.request.post(`/api/v1/${path}`, {
    data,
    headers: { 'X-CSRFToken': csrf.csrfToken },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

async function createJob(page: Page, title: string, recruitmentSites: string[]) {
  const me = await (await page.request.get('/api/v1/me/')).json();
  return postJob(page, 'jobs/', {
    request_id: crypto.randomUUID(),
    title,
    location: '深圳',
    headcount: 1,
    department: me.departments[0].id,
    approver: me.departments[0].approvers[0].id,
    recruitment_sites: recruitmentSites,
  });
}

test('职位可多选招聘网站，列表紧跟薪资显示对应颜色并导出保存内容', async ({ page }, testInfo) => {
  const title = '虚构招聘网站多选验收岗';
  const selected = ['BOSS直聘', '猎聘', '智联招聘'];
  await login(page);
  await openJobs(page, title);
  await page.getByRole('button', { name: '新建职位', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('职位名称').fill(title);
  await dialog.getByLabel('薪资区间', { exact: true }).fill('10-15K');
  await dialog.getByLabel('工作地点').fill('深圳');
  await dialog.getByLabel('招聘人数').fill('2');
  await dialog.getByLabel('用人负责人（用于澄清）').click();
  await page.getByRole('option', { name: /体验负责人/ }).click();
  const choices = dialog.getByRole('group', { name: '招聘网站（可多选）', exact: true });
  await expect(choices.getByRole('checkbox')).toHaveCount(websites.length);
  for (const website of websites) {
    await expect(choices.getByRole('checkbox', { name: website, exact: true })).not.toBeChecked();
  }
  for (const website of selected) {
    await choices.getByRole('checkbox', { name: website, exact: true }).check();
  }
  await choices.scrollIntoViewIfNeeded();
  await dialog.screenshot({ path: testInfo.outputPath('招聘网站选择.png') });
  const createdResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/jobs/') && response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  const created = await createdResponse;
  expect(created.ok(), await created.text()).toBeTruthy();
  expect(created.request().postDataJSON().recruitment_sites).toEqual(selected);
  const job = await created.json();
  expect(job.recruitment_sites).toEqual(selected);
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭详情', exact: true }).click();
  const saved = await page.request.get(`/api/v1/jobs/${job.id}/`);
  expect(saved.ok()).toBeTruthy();
  expect((await saved.json()).recruitment_sites).toEqual(selected);

  const grid = page.getByRole('grid');
  const row = grid.getByRole('row').filter({ hasText: title });
  await expect(row).toHaveCount(1);
  const headers = (await grid.getByRole('columnheader').allTextContents()).map((text) =>
    text.trim(),
  );
  const salaryIndex = headers.indexOf('薪资区间');
  expect(salaryIndex).toBeGreaterThanOrEqual(0);
  expect(headers[salaryIndex + 1]).toBe('招聘网站');
  for (const [website, color] of [
    ['BOSS直聘', 'green'],
    ['猎聘', 'orange'],
    ['智联招聘', 'blue'],
  ]) {
    const tag = row.locator('.semi-tag').filter({ hasText: website });
    await expect(tag).toHaveText(website);
    await expect(tag).toHaveClass(new RegExp(`semi-tag-${color}`));
    await expect(tag).toHaveClass(/light/);
  }
  await page.getByRole('region', { name: '职位列表', exact: true }).screenshot({
    path: testInfo.outputPath('招聘网站列表.png'),
  });
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出本模块', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('职位管理.csv');
  const csvPath = testInfo.outputPath('招聘网站职位导出.csv');
  await download.saveAs(csvPath);
  const csv = await readFile(csvPath, 'utf8');
  const lines = csv.split(/\r?\n/);
  expect(lines[0]).toContain('"薪资区间","招聘网站"');
  const exportedJob = lines.find((line) => line.includes(title));
  expect(exportedJob).toBeDefined();
  for (const website of selected) expect(exportedJob).toContain(website);
});

test('列表自动保存可连续修改清空及重试，详情保留状态原因，关闭职位隐藏入口', async ({
  page,
}, testInfo) => {
  const title = '虚构招聘网站自动保存验收岗';
  await login(page);
  const job = await createJob(page, title, ['BOSS直聘', '猎聘']);
  const updates: { version: number; recruitment_sites: string[] }[] = [];
  let releaseFailure = () => {};
  const failureGate = new Promise<void>((resolve) => {
    releaseFailure = resolve;
  });
  await page.route(`**/api/v1/jobs/${job.id}/recruitment-sites/`, async (route) => {
    updates.push(route.request().postDataJSON());
    if (updates.length === 1) {
      await failureGate;
      return route.fulfill({
        status: 500,
        json: { errors: { detail: '虚构网站保存失败，请重试。' } },
      });
    }
    return route.continue();
  });
  await openJobs(page, title);
  const row = page.getByRole('grid').getByRole('row').filter({ hasText: title });
  const entry = row.getByRole('button', { name: `设置${title}的招聘网站`, exact: true });
  await entry.click();
  const choices = page.getByRole('group', { name: '招聘网站（可多选）', exact: true });
  await expect(choices).toBeVisible();
  await expect(page.getByRole('button', { name: '保存招聘网站', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '取消', exact: true })).toHaveCount(0);
  const listReads: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'GET' && new URL(request.url()).pathname === '/api/v1/jobs/')
      listReads.push(request.url());
  });
  // 勾选状态以保存后的职位为准；先点击，再等待请求结果与页面回写。
  await choices.getByRole('checkbox', { name: '猎聘', exact: true }).click();
  try {
    await expect.poll(() => updates.length).toBe(1);
    for (const website of websites)
      await expect(choices.getByRole('checkbox', { name: website, exact: true })).toBeDisabled();
  } finally {
    releaseFailure();
  }
  await expect(
    page.getByRole('alert').filter({ hasText: '虚构网站保存失败，请重试。' }),
  ).toBeVisible();
  await expect(row.locator('.semi-tag')).toHaveText(['BOSS直聘', '猎聘']);
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '已自动保存' })).toBeVisible();
  await expect(row.locator('.semi-tag')).toHaveText(['BOSS直聘']);
  await expect(choices).toBeVisible();
  await choices.getByRole('checkbox', { name: '智联招聘', exact: true }).click();
  await expect(row.locator('.semi-tag')).toHaveText(['BOSS直聘', '智联招聘']);
  await choices.getByRole('checkbox', { name: 'BOSS直聘', exact: true }).click();
  await expect(row.locator('.semi-tag')).toHaveText(['智联招聘']);
  await choices.getByRole('checkbox', { name: '智联招聘', exact: true }).click();
  await expect(row.locator('.semi-tag')).toHaveCount(0);
  await expect(choices.getByRole('checkbox', { checked: true })).toHaveCount(0);
  expect(updates).toEqual([
    { version: job.version, recruitment_sites: ['BOSS直聘'] },
    { version: job.version, recruitment_sites: ['BOSS直聘'] },
    { version: job.version + 1, recruitment_sites: ['BOSS直聘', '智联招聘'] },
    { version: job.version + 2, recruitment_sites: ['智联招聘'] },
    { version: job.version + 3, recruitment_sites: [] },
  ]);
  expect(listReads).toHaveLength(0);
  await page.keyboard.press('Escape');
  await expect(choices).toHaveCount(0);
  await expect(entry).toBeVisible();
  await page.reload();
  await page.getByLabel('搜索职位或地点', { exact: true }).fill(title);
  await expect(entry).toBeVisible();
  await expect(row.locator('.semi-tag')).toHaveCount(0);
  const cleared = await (await page.request.get(`/api/v1/jobs/${job.id}/`)).json();
  expect(cleared.recruitment_sites).toEqual([]);
  expect(cleared.version).toBe(job.version + 4);

  await row.getByRole('button', { name: title, exact: true }).click();
  const detail = page.getByRole('dialog', { name: title, exact: true });
  await detail.getByRole('tab', { name: '职位信息', exact: true }).click();
  const nextStatus = detail.getByLabel('调整职位状态', { exact: true });
  const statusReason = detail.getByLabel('调整原因', { exact: true });
  await nextStatus.click();
  await page.getByRole('option', { name: /关闭职位/ }).click();
  await statusReason.fill('稍后处理的状态原因');
  await detail.getByRole('button', { name: `设置${title}的招聘网站`, exact: true }).click();
  await choices.getByRole('checkbox', { name: '其他', exact: true }).click();
  await expect(detail.locator('.semi-tag').filter({ hasText: '其他' })).toHaveText('其他');
  await expect(page.getByRole('status').filter({ hasText: '已自动保存' })).toBeVisible();
  await expect(choices).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('招聘网站自动保存.png') });
  await page.keyboard.press('Escape');
  await expect(choices).toHaveCount(0);
  await expect(detail).toBeVisible();
  await expect(nextStatus).toContainText('关闭职位');
  await expect(statusReason).toHaveValue('稍后处理的状态原因');
  expect(updates[5]).toEqual({ version: job.version + 4, recruitment_sites: ['其他'] });
  const updated = await (await page.request.get(`/api/v1/jobs/${job.id}/`)).json();
  expect(updated.status).toBe('draft');
  expect(updated.version).toBe(job.version + 5);
  await statusReason.fill('虚构验收结束，关闭测试职位');
  await detail.getByRole('button', { name: '确认调整', exact: true }).click();
  await expect(
    detail.getByRole('button', { name: `设置${title}的招聘网站`, exact: true }),
  ).toHaveCount(0);
  await expect(detail.locator('.semi-tag').filter({ hasText: '其他' })).toHaveText('其他');
  await detail.getByRole('button', { name: '关闭详情', exact: true }).click();
  await expect(entry).toHaveCount(0);
  await expect(row.locator('.semi-tag')).toHaveText(['其他']);
});

test('网站冲突不覆盖，损坏或丢失响应可恢复且不重复写入，只读账号没有编辑入口', async ({ page }) => {
  const title = '虚构招聘网站冲突验收岗';
  await login(page);
  const job = await createJob(page, title, ['BOSS直聘']);
  const updates: { version: number; recruitment_sites: string[] }[] = [];
  let detailReads = 0;
  let failNextRead = false;
  await page.route(`**/api/v1/jobs/${job.id}/`, (route) => {
    detailReads++;
    if (failNextRead) {
      failNextRead = false;
      return route.fulfill({ status: 503, json: { errors: { detail: '虚构回读暂不可用。' } } });
    }
    return route.continue();
  });
  await page.route(`**/api/v1/jobs/${job.id}/recruitment-sites/`, async (route) => {
    updates.push(route.request().postDataJSON());
    if ([2, 3, 4].includes(updates.length)) {
      const response = await route.fetch();
      expect(response.ok(), await response.text()).toBeTruthy();
      if (updates.length === 3)
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{"job":' });
      if (updates.length === 4) failNextRead = true;
      return route.abort('failed');
    }
    return route.continue();
  });
  await openJobs(page, title);
  const row = page.getByRole('grid').getByRole('row').filter({ hasText: title });
  const entry = row.getByRole('button', { name: `设置${title}的招聘网站`, exact: true });
  await entry.click();
  const choices = page.getByRole('group', { name: '招聘网站（可多选）', exact: true });
  await expect(choices.getByRole('checkbox', { name: 'BOSS直聘', exact: true })).toBeChecked();
  // 另一窗口先保存，当前弹层仍持有旧版本；真实后端必须拒绝旧版本覆盖。
  const concurrent = await postJob(page, `jobs/${job.id}/recruitment-sites/`, {
    version: job.version,
    recruitment_sites: ['猎聘'],
  });
  const readsBeforeConflict = detailReads;
  await choices.getByRole('checkbox', { name: '智联招聘', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '重新选择' })).toBeVisible();
  await expect(row.locator('.semi-tag')).toHaveText(['猎聘']);
  await expect(choices.getByRole('checkbox', { name: '猎聘', exact: true })).toBeChecked();
  await expect(choices.getByRole('checkbox', { name: 'BOSS直聘', exact: true })).not.toBeChecked();
  await expect(choices.getByRole('checkbox', { name: '智联招聘', exact: true })).not.toBeChecked();
  expect(detailReads).toBeGreaterThan(readsBeforeConflict);
  expect(updates).toEqual([{ version: job.version, recruitment_sites: ['BOSS直聘', '智联招聘'] }]);
  const afterConflict = await (await page.request.get(`/api/v1/jobs/${job.id}/`)).json();
  expect(afterConflict.recruitment_sites).toEqual(['猎聘']);
  expect(afterConflict.version).toBe(concurrent.version);

  const readsBeforeLostResponse = detailReads;
  await choices.getByRole('checkbox', { name: 'BOSS直聘', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '已自动保存' })).toBeVisible();
  await expect(row.locator('.semi-tag')).toHaveText(['猎聘', 'BOSS直聘']);
  await expect(choices).toBeVisible();
  expect(detailReads).toBeGreaterThan(readsBeforeLostResponse);
  expect(updates).toHaveLength(2);
  expect(updates[1]).toEqual({
    version: concurrent.version,
    recruitment_sites: ['猎聘', 'BOSS直聘'],
  });
  const saved = await (await page.request.get(`/api/v1/jobs/${job.id}/`)).json();
  expect(saved.recruitment_sites).toEqual(['猎聘', 'BOSS直聘']);
  expect(saved.version).toBe(concurrent.version + 1);

  const readsBeforeBrokenJson = detailReads;
  const afterBrokenJsonSites = ['猎聘', 'BOSS直聘', '拉勾招聘'];
  await choices.getByRole('checkbox', { name: '拉勾招聘', exact: true }).click();
  await expect(row.locator('.semi-tag')).toHaveText(afterBrokenJsonSites);
  await expect(page.getByRole('status').filter({ hasText: '已自动保存' })).toBeVisible();
  expect(detailReads).toBeGreaterThan(readsBeforeBrokenJson);
  expect(updates).toHaveLength(3);
  expect(updates[2]).toEqual({ version: saved.version, recruitment_sites: afterBrokenJsonSites });
  const afterBrokenJson = await (await page.request.get(`/api/v1/jobs/${job.id}/`)).json();
  expect(afterBrokenJson.recruitment_sites).toEqual(afterBrokenJsonSites);
  expect(afterBrokenJson.version).toBe(saved.version + 1);

  // 写入成功但响应和回读都失败时，页面只能说结果未确认；重试旧版本不能再写一次。
  const finalSites = [...afterBrokenJsonSites, '其他'];
  const readsBeforeUncertain = detailReads;
  await choices.getByRole('checkbox', { name: '其他', exact: true }).click();
  const uncertain = page.getByRole('alert').filter({
    hasText: '暂时无法确认保存结果，请稍后重试。',
  });
  await expect(uncertain).toBeVisible();
  await expect(uncertain).not.toContainText('未保存');
  await expect(row.locator('.semi-tag')).toHaveText(afterBrokenJsonSites);
  await expect(choices.getByRole('checkbox', { name: '其他', exact: true })).not.toBeChecked();
  expect(detailReads).toBeGreaterThan(readsBeforeUncertain);
  expect(updates).toHaveLength(4);
  const committed = await (await page.request.get(`/api/v1/jobs/${job.id}/`)).json();
  expect(committed.recruitment_sites).toEqual(finalSites);
  expect(committed.version).toBe(afterBrokenJson.version + 1);
  const readsBeforeRetry = detailReads;
  const retryResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/v1/jobs/${job.id}/recruitment-sites/`) &&
      response.request().method() === 'POST',
  );
  await uncertain.getByRole('button', { name: '重试', exact: true }).click();
  expect((await retryResponse).status()).toBe(409);
  await expect(row.locator('.semi-tag')).toHaveText(finalSites);
  await expect(page.getByRole('status').filter({ hasText: '已自动保存' })).toBeVisible();
  await expect(choices).toBeVisible();
  expect(detailReads).toBeGreaterThan(readsBeforeRetry);
  expect(updates).toHaveLength(5);
  expect(updates[3]).toEqual({ version: afterBrokenJson.version, recruitment_sites: finalSites });
  expect(updates[4]).toEqual(updates[3]);
  const recovered = await (await page.request.get(`/api/v1/jobs/${job.id}/`)).json();
  expect(recovered.recruitment_sites).toEqual(finalSites);
  expect(recovered.version).toBe(committed.version);

  await page.keyboard.press('Escape');
  await expect(choices).toHaveCount(0);
  await login(page, 'local_manager');
  await openJobs(page, title);
  await expect(row.locator('.semi-tag')).toHaveText(finalSites);
  await expect(entry).toHaveCount(0);
  const visibleJob = await (await page.request.get(`/api/v1/jobs/${job.id}/`)).json();
  expect(visibleJob.permissions.edit).toBe(false);
  await row.getByRole('button', { name: title, exact: true }).click();
  const detail = page.getByRole('dialog', { name: title, exact: true });
  await detail.getByRole('tab', { name: '职位信息', exact: true }).click();
  await expect(detail.locator('.semi-tag')).toHaveText(finalSites);
  await expect(
    detail.getByRole('button', { name: `设置${title}的招聘网站`, exact: true }),
  ).toHaveCount(0);
  expect(updates).toHaveLength(5);
});
