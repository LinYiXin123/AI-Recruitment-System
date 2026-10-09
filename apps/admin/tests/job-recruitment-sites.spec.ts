import { readFile } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';
import { login } from './helpers';

const websites = ['BOSS直聘', '猎聘', '智联招聘', '前程无忧', '拉勾招聘', '其他'];

async function openJobs(page: Page, title: string) {
  await page.getByRole('link', { name: '职位', exact: true }).click();
  await page.getByLabel('搜索职位或地点', { exact: true }).fill(title);
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

test('招聘网站修改失败保留选择，重试及清空后刷新仍与保存结果一致', async ({ page }) => {
  const title = '虚构招聘网站修改验收岗';
  await login(page);
  const me = await (await page.request.get('/api/v1/me/')).json();
  const csrf = await (await page.request.get('/api/v1/auth/csrf/')).json();
  const created = await page.request.post('/api/v1/jobs/', {
    data: {
      request_id: crypto.randomUUID(),
      title,
      location: '深圳',
      headcount: 1,
      department: me.departments[0].id,
      approver: me.departments[0].approvers[0].id,
      recruitment_sites: ['BOSS直聘', '猎聘'],
    },
    headers: { 'X-CSRFToken': csrf.csrfToken },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const job = await created.json();
  const updates: { version: number; recruitment_sites: string[] }[] = [];
  await page.route(`**/api/v1/jobs/${job.id}/recruitment-sites/`, (route) => {
    updates.push(route.request().postDataJSON());
    return updates.length === 1
      ? route.fulfill({ status: 500, json: { errors: { detail: '虚构网站保存失败，请重试。' } } })
      : route.continue();
  });
  await openJobs(page, title);
  await page.getByRole('button', { name: title, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: '职位信息', exact: true }).click();
  await dialog.getByRole('button', { name: '修改招聘网站', exact: true }).click();
  const choices = dialog.getByRole('group', { name: '招聘网站（可多选）', exact: true });
  await expect(choices.getByRole('checkbox', { name: 'BOSS直聘', exact: true })).toBeChecked();
  await expect(choices.getByRole('checkbox', { name: '猎聘', exact: true })).toBeChecked();
  await choices.getByRole('checkbox', { name: '智联招聘', exact: true }).check();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(choices).toHaveCount(0);
  expect(updates).toHaveLength(0);
  await dialog.getByRole('button', { name: '修改招聘网站', exact: true }).click();
  await expect(choices.getByRole('checkbox', { name: '智联招聘', exact: true })).not.toBeChecked();
  await choices.getByRole('checkbox', { name: '猎聘', exact: true }).uncheck();
  await choices.getByRole('checkbox', { name: '智联招聘', exact: true }).check();
  const nextStatus = dialog.getByLabel('调整职位状态', { exact: true });
  const statusReason = dialog.getByLabel('调整原因', { exact: true });
  await nextStatus.click();
  await page.getByRole('option', { name: /关闭职位/ }).click();
  await statusReason.fill('稍后处理的状态原因');
  await dialog.getByRole('button', { name: '保存招聘网站', exact: true }).click();
  await expect(
    dialog.getByRole('alert').filter({ hasText: '虚构网站保存失败，请重试。' }),
  ).toBeVisible();
  await expect(choices.getByRole('checkbox', { name: 'BOSS直聘', exact: true })).toBeChecked();
  await expect(choices.getByRole('checkbox', { name: '猎聘', exact: true })).not.toBeChecked();
  await expect(choices.getByRole('checkbox', { name: '智联招聘', exact: true })).toBeChecked();
  await dialog.getByRole('button', { name: '保存招聘网站', exact: true }).click();
  await expect(choices).toHaveCount(0);
  await expect(nextStatus).toContainText('关闭职位');
  await expect(statusReason).toHaveValue('稍后处理的状态原因');
  await statusReason.fill('');
  await nextStatus.click();
  await page.getByRole('option', { name: /选择下一步/ }).click();
  expect(updates).toHaveLength(2);
  expect(updates[0]).toEqual({ version: job.version, recruitment_sites: ['BOSS直聘', '智联招聘'] });
  expect(updates[1]).toEqual(updates[0]);
  const updatedResponse = await page.request.get(`/api/v1/jobs/${job.id}/`);
  expect(updatedResponse.ok()).toBeTruthy();
  const updated = await updatedResponse.json();
  expect(updated.recruitment_sites).toEqual(['BOSS直聘', '智联招聘']);
  expect(updated.status).toBe('draft');
  expect(updated.version).toBe(job.version + 1);

  await dialog.getByRole('button', { name: '修改招聘网站', exact: true }).click();
  for (const website of websites) {
    await choices.getByRole('checkbox', { name: website, exact: true }).uncheck();
  }
  await dialog.getByRole('button', { name: '保存招聘网站', exact: true }).click();
  await expect(choices).toHaveCount(0);
  expect(updates[2]).toEqual({ version: updated.version, recruitment_sites: [] });
  await page.reload();
  await page.getByLabel('搜索职位或地点', { exact: true }).fill(title);
  await page.getByRole('button', { name: title, exact: true }).click();
  await dialog.getByRole('tab', { name: '职位信息', exact: true }).click();
  await expect(dialog.locator('.semi-tag')).toHaveCount(0);
  await dialog.getByRole('button', { name: '修改招聘网站', exact: true }).click();
  for (const website of websites) {
    await expect(choices.getByRole('checkbox', { name: website, exact: true })).not.toBeChecked();
  }
  const clearedResponse = await page.request.get(`/api/v1/jobs/${job.id}/`);
  expect(clearedResponse.ok()).toBeTruthy();
  const cleared = await clearedResponse.json();
  expect(cleared.recruitment_sites).toEqual([]);
  expect(cleared.version).toBe(job.version + 2);
});
