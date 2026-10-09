import { readFile } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';
import { login } from './helpers';

const resumeText = `姓名：测试甲
手机：13800000101
邮箱：candidate-library@example.com
性别：女
现居城市：泉州
生日：1998-09-28
意向岗位：前端工程师
最高学历：本科
毕业院校：虚构大学
工作年限：4 年
当前薪资：9K
期望薪资：12-15K · 13薪
工作经历
2022.06 至今 虚构公司 前端工程师
负责虚构业务页面。
教育经历
2018.09-2022.06 虚构大学 软件工程 本科`;
const resume = {
  name: 'fictional-candidate-library.txt',
  mimeType: 'text/plain',
  buffer: Buffer.from(resumeText),
};

async function openForm(page: Page) {
  await login(page);
  await page.getByRole('link', { name: '候选人', exact: true }).click();
  await page.getByRole('button', { name: '新增候选人', exact: true }).click();
  await expect(page.locator('#create-candidate-form')).toBeVisible();
}

async function upload(page: Page, file = resume) {
  const response = page.waitForResponse('**/api/v1/candidates/preview-resume/');
  await page.locator('.candidate-resume-input').setInputFiles(file);
  const result = await response;
  expect(result.ok(), await result.text()).toBeTruthy();
  await expect(page.getByRole('button', { name: '保存', exact: true })).toBeEnabled();
  return result.json();
}

test('上传简历仍在原表单，核对保存后回到候选人列表且刷新保留字段和附件', async ({
  page,
}, testInfo) => {
  await openForm(page);
  const preview = await upload(page);
  expect(preview.parse.status).toBe('succeeded');
  await expect(page.locator('#create-candidate-form')).toBeVisible();
  await expect(page.getByRole('heading', { name: '导入简历', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '开始导入', exact: true })).toHaveCount(0);
  for (const [field, value] of Object.entries({
    name: '测试甲',
    phone: '13800000101',
    email: 'candidate-library@example.com',
    city: '泉州',
    birthday: '1998-09-28',
    'intended-role': '前端工程师',
    school: '虚构大学',
    'work-years': '4 年',
    'current-salary': '9K',
    'expected-salary': '12-15K · 13薪',
    'work-experience': '2022.06 至今 虚构公司 前端工程师\n负责虚构业务页面。',
    'education-experience': '2018.09-2022.06 虚构大学 软件工程 本科',
    'resume-text': resumeText,
  })) {
    await expect(page.locator(`#new-candidate-${field}`)).toHaveValue(value);
  }
  await expect(page.locator('#new-candidate-education-level')).toContainText('本科');
  await expect(page.locator('#new-candidate-gender')).toContainText('女');
  await page.locator('#new-candidate-name').fill('虚构入库甲');
  await page.locator('#new-candidate-city').fill('厦门');
  await page.locator('#new-candidate-expected-salary').fill('15-18K · 13薪');
  await page.locator('.candidate-resume-choice').scrollIntoViewIfNeeded();
  await page.screenshot({
    path: '../../.local/candidate-library-task/上传后原表单.png',
    fullPage: true,
  });
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/candidates/') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const response = await saved;
  expect(response.ok(), await response.text()).toBeTruthy();
  expect(response.request().postDataJSON()).toMatchObject({
    job: null,
    source: '',
    resume_document: preview.document,
    resume_parse: preview.parse.id,
  });
  const created = await response.json();
  expect(created.application).toBeNull();
  await expect(page.locator('#create-candidate-form')).toHaveCount(0);
  await expect(page.getByText('候选人已保存。', { exact: true })).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: '虚构入库甲' });
  await expect(row).toHaveCount(1);
  for (const value of ['厦门', '本科', '4 年', '15-18K · 13薪', '待筛选'])
    await expect(row).toContainText(value);
  await page.screenshot({
    path: '../../.local/candidate-library-task/保存后候选人列表.png',
    fullPage: true,
  });
  for (const heading of [
    '姓名',
    '应聘职位',
    '现居城市',
    '最高学历',
    '工作年限',
    '期望薪资',
    '简历来源',
    '当前状态',
  ])
    await expect(page.getByRole('columnheader', { name: heading, exact: true })).toBeVisible();
  await page.reload();
  await page.getByLabel('搜索候选人').fill('虚构入库甲');
  await expect(row).toHaveCount(1);
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出本模块', exact: true }).click();
  const exported = await downloadEvent;
  const exportPath = testInfo.outputPath('候选人库.csv');
  await exported.saveAs(exportPath);
  const csv = await readFile(exportPath, 'utf8');
  expect(csv).toContain(
    '"姓名","应聘职位","现居城市","最高学历","工作年限","期望薪资","简历来源","当前状态"',
  );
  expect(csv).toContain('"虚构入库甲","","厦门","本科","4 年","15-18K · 13薪","","待筛选"');
  await row.getByRole('button', { name: '详情', exact: true }).click();
  const details = page.getByRole('region', { name: '候选人详情', exact: true });
  await expect(page).toHaveURL(new RegExp(`#candidate/${created.candidate}$`));
  await expect(details.getByRole('heading', { name: '虚构入库甲', exact: true })).toBeVisible();
  await expect(details.locator('dl')).toContainText('厦门');
  await expect(details.locator('dl')).toContainText('15-18K · 13薪');
  await expect(details.getByRole('region', { name: '应聘记录' })).toHaveCount(0);
  await details.getByRole('tab', { name: '简历原文', exact: true }).click();
  await expect(details.locator('.candidate-detail-resume')).toContainText(resume.name);
  const person = await (await page.request.get(`/api/v1/candidates/${created.candidate}/`)).json();
  const canDownload = person.resume_documents[0].download;
  // 默认 seed 只有资料查看权限；独立 UI 验收库可另授下载权限，按钮和接口须保持一致。
  await expect(details.getByRole('link', { name: '下载', exact: true })).toHaveCount(
    canDownload ? 1 : 0,
  );
  await expect(details.getByRole('link', { name: '查看', exact: true })).toHaveCount(
    canDownload ? 1 : 0,
  );
  const download = await page.request.get(`/api/v1/documents/${preview.document}/download/`);
  expect(download.status()).toBe(canDownload ? 200 : 403);
  if (canDownload) expect(await download.body()).toEqual(resume.buffer);
  expect(person).toMatchObject({
    display_name: '虚构入库甲',
    current_city: '厦门',
    education_level: '本科',
    work_years: '4 年',
    expected_salary: '15-18K · 13薪',
    source: '',
    applications: [],
  });
  expect(person.resume_documents).toHaveLength(1);
  expect(person.resume_documents[0]).toMatchObject({
    document: preview.document,
    download: canDownload,
  });
});

test('保存响应丢失后保留表单，重试只保存一个候选人及一份附件', async ({ page }) => {
  await openForm(page);
  await upload(page, {
    ...resume,
    name: 'fictional-candidate-retry.txt',
    buffer: Buffer.from('姓名：测试乙\n邮箱：candidate-retry@example.com\n现居城市：泉州'),
  });
  await page.locator('#new-candidate-name').fill('虚构重试乙');
  const keys: string[] = [];
  let markFirstSaved = () => {};
  const firstSaved = new Promise<void>((resolve) => {
    markFirstSaved = resolve;
  });
  let releaseResponse = () => {};
  const responsePending = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  await page.route('**/api/v1/candidates/', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    keys.push(route.request().postDataJSON().request_key);
    if (keys.length === 1) {
      const response = await route.fetch();
      expect(response.ok(), await response.text()).toBeTruthy();
      markFirstSaved();
      await responsePending;
      await route.abort();
    } else await route.continue();
  });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await firstSaved;
  try {
    await page.keyboard.press('Escape');
    await expect(page.locator('#create-candidate-form')).toBeVisible();
    await expect(page.getByRole('button', { name: '正在保存…', exact: true })).toBeDisabled();
  } finally {
    releaseResponse();
  }
  await expect(page.getByRole('alert')).toContainText('暂时连接不上服务');
  await expect(page.locator('#new-candidate-name')).toHaveValue('虚构重试乙');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('#create-candidate-form')).toHaveCount(0);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  const people = await (
    await page.request.get(`/api/v1/candidates/?search=${encodeURIComponent('虚构重试乙')}`)
  ).json();
  expect(people.count).toBe(1);
  const person = await (
    await page.request.get(`/api/v1/candidates/${people.results[0].id}/`)
  ).json();
  expect(person.applications).toEqual([]);
  expect(person.resume_documents).toHaveLength(1);
});

test('解析失败及无效文件不会清空已有表单，可继续人工填写并保存附件', async ({ page }) => {
  await openForm(page);
  await upload(page, {
    ...resume,
    name: 'fictional-candidate-preserved.txt',
    buffer: Buffer.from(
      '姓名：测试丙\n邮箱：candidate-preserved@example.com\n现居城市：泉州\n期望薪资：12K',
    ),
  });
  await page.locator('#new-candidate-city').fill('厦门');
  const originalText = await page.locator('#new-candidate-resume-text').inputValue();
  const failed = await upload(page, {
    name: 'fictional-damaged.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\ninvalid'),
  });
  expect(failed.parse.status).toBe('failed');
  await expect(page.getByRole('alert')).toContainText(failed.parse.error);
  await expect(page.locator('#new-candidate-name')).toHaveValue('测试丙');
  await expect(page.locator('#new-candidate-city')).toHaveValue('厦门');
  await expect(page.locator('#new-candidate-expected-salary')).toHaveValue('12K');
  await expect(page.locator('#new-candidate-resume-text')).toHaveValue(originalText);
  const rejected = page.waitForResponse('**/api/v1/candidates/preview-resume/');
  await page.locator('.candidate-resume-input').setInputFiles({
    name: 'fictional-invalid.exe',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('invalid'),
  });
  expect((await rejected).status()).toBe(400);
  await expect(page.getByRole('alert')).toContainText('文件内容与格式不符');
  await expect(page.locator('#new-candidate-name')).toHaveValue('测试丙');
  await expect(page.locator('#new-candidate-city')).toHaveValue('厦门');
  await expect(page.locator('#new-candidate-resume-text')).toHaveValue(originalText);
  await expect(page.locator('.candidate-resume-choice')).toContainText('fictional-damaged.pdf');
  await page.locator('#new-candidate-name').fill('虚构手填丙');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('#create-candidate-form')).toHaveCount(0);
  const row = page.getByRole('row').filter({ hasText: '虚构手填丙' });
  await expect(row).toContainText('厦门');
  await row.getByRole('button', { name: '详情', exact: true }).click();
  await page.getByRole('tab', { name: '简历原文', exact: true }).click();
  await expect(page.locator('.candidate-detail-resume')).toContainText('fictional-damaged.pdf');
});
