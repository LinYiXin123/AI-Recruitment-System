import { readFile } from 'node:fs/promises';
import { expect, type Page, type TestInfo, test } from '@playwright/test';
import { login } from './helpers';

test.use({ viewport: { width: 1596, height: 1476 } });

async function createQuestion(page: Page, values: Record<string, string | undefined>) {
  const csrf = await (await page.request.get('/api/v1/auth/csrf/')).json();
  const response = await page.request.post('/api/v1/question-templates/', {
    data: {
      request_key: crypto.randomUUID(),
      job_title: '题库验收岗（虚构）',
      dimension: '专业能力',
      difficulty: '中等',
      reference_answer: '说明具体事实及验证过程。',
      ...values,
    },
    headers: { 'X-CSRFToken': csrf.csrfToken },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

function recordErrors(page: Page, testInfo: TestInfo) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`页面异常：${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`控制台：${message.text()}`);
  });
  return async (expectedSaveFailure = false) => {
    await testInfo.attach('控制台错误', {
      body: JSON.stringify(errors, null, 2),
      contentType: 'application/json',
    });
    expect(
      errors.filter(
        (message) =>
          !(
            expectedSaveFailure &&
            message.startsWith('控制台：Failed to load resource:') &&
            message.includes('503')
          ),
      ),
    ).toEqual([]);
  };
}

test('题库新增和编辑真实保存，弹窗下拉支持点击与键盘并保留刷新结果', async ({ page }, testInfo) => {
  const checkErrors = recordErrors(page, testInfo);
  const content = `创建验收 ${crypto.randomUUID()}：如何核实一个项目中的个人贡献？`;
  const answer = '请说明目标、本人职责、采取的行动和可验证结果。\n追问：哪些证据来自本人？';
  await login(page);
  await page.getByRole('link', { name: '面试题库', exact: true }).click();
  const initial = await page.request.get('/api/v1/question-templates/');
  if ((await initial.json()).count === 0) {
    await expect(page.getByText('还没有数据', { exact: true })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('面试题库-空数据-1596x1476.png'),
      fullPage: true,
    });
  }
  await page.getByRole('button', { name: '新增题目', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  expect(
    await dialog.evaluate((element) => element.tagName === 'DIALOG' && element.matches(':modal')),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('面试题库-新增-1596x1476.png'),
    fullPage: true,
  });
  await dialog.getByLabel('题目内容', { exact: false }).fill(content);
  await dialog.getByLabel('适用职位', { exact: true }).fill('题库验收岗（虚构）');
  const dimension = dialog.getByRole('combobox', { name: '考察维度', exact: true });
  await dimension.click();
  const professional = page.getByRole('option', { name: '专业能力' });
  await expect(professional).toBeVisible();
  expect(await professional.evaluate((element) => Boolean(element.closest('dialog')))).toBe(true);
  await professional.click();
  await expect(dimension).toContainText('专业能力');
  const difficulty = dialog.getByRole('combobox', { name: '难度', exact: true });
  await difficulty.click();
  await page.getByRole('option', { name: '简单' }).click();
  await expect(difficulty).toContainText('简单');
  await difficulty.press('ArrowDown');
  await expect(page.getByRole('option', { name: '中等' })).toBeVisible();
  await difficulty.press('ArrowDown');
  await difficulty.press('Enter');
  await expect(difficulty).toContainText('中等');
  await dialog.getByLabel('参考答案要点', { exact: true }).fill(answer);
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await page.getByRole('searchbox', { name: '搜索题目', exact: true }).fill(content);
  const row = page.getByRole('row').filter({ hasText: content });
  await expect(row).toContainText('题库验收岗（虚构）');
  await expect(row).toContainText('专业能力');
  await expect(row).toContainText('中等');
  await page.screenshot({
    path: testInfo.outputPath('面试题库-列表-1596x1476.png'),
    fullPage: true,
  });
  await row.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(dialog.getByLabel('参考答案要点', { exact: true })).toHaveValue(answer);
  const editedAnswer = `${answer}\n补充：核对团队分工和本人交付物。`;
  await dialog.getByLabel('参考答案要点', { exact: true }).fill(editedAnswer);
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await page.getByRole('searchbox', { name: '搜索题目', exact: true }).fill(content);
  await row.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(dialog.getByLabel('题目内容', { exact: false })).toHaveValue(content);
  await expect(dialog.getByLabel('参考答案要点', { exact: true })).toHaveValue(editedAnswer);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '新增题目', exact: true }).click();
  const mobileBox = await dialog.boundingBox();
  if (!mobileBox) throw new Error('窄屏新增题目弹窗应当可见。');
  expect(mobileBox.x).toBeGreaterThanOrEqual(0);
  expect(mobileBox.x + mobileBox.width).toBeLessThanOrEqual(390);
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('面试题库-新增-390x844.png'), fullPage: true });
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await checkErrors();
});

test('题库组合筛选、重置和无匹配真实生效，导出包含筛选外的完整题目', async ({ page }, testInfo) => {
  const checkErrors = recordErrors(page, testInfo);
  await login(page);
  const run = `筛选验收-${crypto.randomUUID()}`;
  const job = `${run}-职位`;
  const fullAnswer = `第一点：需要保留逗号,与“中文”及英文"引号"。\n${'完整参考答案不可在导出中截断。'.repeat(35)}\n最后一个验证要点。`;
  const rows = [
    { content: `${run}匹配-目标`, job_title: job, reference_answer: fullAnswer },
    { content: `${run}匹配-其他职位`, job_title: `${run}-其他职位` },
    { content: `${run}匹配-其他维度`, job_title: job, dimension: '沟通表达' },
    { content: `${run}匹配-其他难度`, job_title: job, difficulty: '困难' },
    { content: `${run}其他关键词`, job_title: job },
  ];
  for (const values of rows) await createQuestion(page, values);
  await page.getByRole('link', { name: '面试题库', exact: true }).click();
  const search = page.getByRole('searchbox', { name: '搜索题目', exact: true });
  await search.fill(`${run}匹配`);
  for (const [label, value] of [
    ['适用职位筛选', job],
    ['考察维度筛选', '专业能力'],
    ['难度筛选', '中等'],
  ]) {
    await page.getByRole('combobox', { name: label, exact: true }).click();
    await page.getByRole('option', { name: value }).click();
  }
  const dataRows = page.getByRole('row').filter({
    has: page.getByRole('button', { name: '编辑', exact: true }),
  });
  await expect(dataRows).toHaveCount(1);
  await expect(dataRows).toContainText(rows[0].content);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出本模块', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('面试题库.csv');
  const csvPath = testInfo.outputPath('面试题库-完整导出.csv');
  await download.saveAs(csvPath);
  const csv = await readFile(csvPath, 'utf8');
  for (const values of rows) expect(csv).toContain(values.content);
  expect(csv).toContain(fullAnswer.replaceAll('"', '""'));
  await page.getByRole('button', { name: '重置', exact: true }).click();
  await expect(search).toHaveValue('');
  for (const label of ['适用职位筛选', '考察维度筛选', '难度筛选']) {
    await expect(page.getByRole('combobox', { name: label, exact: true })).toContainText('全部');
  }
  await search.fill(run);
  await expect(dataRows).toHaveCount(5);
  await search.fill(`不存在的题目-${crypto.randomUUID()}`);
  await expect(dataRows).toHaveCount(0);
  await expect(page.getByText('没有符合条件的题目', { exact: true })).toBeVisible();
  await checkErrors();
});

test('题目保存失败保留输入可重试，删除须确认且刷新后不再出现', async ({ page }, testInfo) => {
  const checkErrors = recordErrors(page, testInfo);
  await login(page);
  const content = `失败重试验收-${crypto.randomUUID()}`;
  const answer = '这是失败后必须完整保留的参考答案。';
  let failed = false;
  await page.route('**/api/v1/question-templates/', async (route) => {
    if (route.request().method() === 'POST' && !failed) {
      failed = true;
      await route.fulfill({
        status: 503,
        json: { errors: { detail: '题目暂时未保存，请重试。' } },
      });
    } else {
      await route.continue();
    }
  });
  await page.getByRole('link', { name: '面试题库', exact: true }).click();
  await page.getByRole('button', { name: '新增题目', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('题目内容', { exact: false }).fill(content);
  await dialog.getByLabel('参考答案要点', { exact: true }).fill(answer);
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('题目暂时未保存，请重试。');
  await expect(dialog.getByLabel('题目内容', { exact: false })).toHaveValue(content);
  await expect(dialog.getByLabel('参考答案要点', { exact: true })).toHaveValue(answer);
  const beforeRetry = await page.request.get('/api/v1/question-templates/', {
    params: { q: content },
  });
  expect((await beforeRetry.json()).count).toBe(0);
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const saved = await page.request.get('/api/v1/question-templates/', { params: { q: content } });
  const result = await saved.json();
  expect(result.count).toBe(1);
  expect(result.items[0].reference_answer).toBe(answer);
  await page.getByRole('searchbox', { name: '搜索题目', exact: true }).fill(content);
  const row = page.getByRole('row').filter({ hasText: content });
  const cancelledPrompt = page.waitForEvent('dialog');
  const cancelledClick = row.getByRole('button', { name: '删除', exact: true }).click();
  const cancelledDialog = await cancelledPrompt;
  expect(cancelledDialog.message()).toContain(content);
  await cancelledDialog.dismiss();
  await cancelledClick;
  await expect(row).toBeVisible();
  const deletedPrompt = page.waitForEvent('dialog');
  const deletedClick = row.getByRole('button', { name: '删除', exact: true }).click();
  await (await deletedPrompt).accept();
  await deletedClick;
  await expect(row).toHaveCount(0);
  await page.reload();
  await page.getByRole('searchbox', { name: '搜索题目', exact: true }).fill(content);
  await expect(row).toHaveCount(0);
  const deleted = await page.request.get('/api/v1/question-templates/', { params: { q: content } });
  expect((await deleted.json()).count).toBe(0);
  await checkErrors(true);
});

test('只读角色可查看导出但不能写入，窄屏列表和详情不溢出', async ({ page, browser }, testInfo) => {
  await login(page);
  const content = `只读权限验收-${crypto.randomUUID()}`;
  const answer = '只读用户仍应看到这份完整参考答案，用于准备本场面试。';
  const question = await createQuestion(page, { content, reference_answer: answer });
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    viewport: { width: 390, height: 844 },
  });
  const reader = await context.newPage();
  const checkErrors = recordErrors(reader, testInfo);
  try {
    await login(reader, 'local_manager');
    await reader.goto('/#question-bank');
    const response = await reader.request.get('/api/v1/question-templates/', {
      params: { q: content },
    });
    const result = await response.json();
    expect(result.can_manage).toBe(false);
    expect(result.items.some((item: { id: number }) => item.id === question.id)).toBe(true);
    await expect(reader.getByRole('button', { name: '新增题目', exact: true })).toHaveCount(0);
    await expect(reader.getByRole('button', { name: '编辑', exact: true })).toHaveCount(0);
    await expect(reader.getByRole('button', { name: '删除', exact: true })).toHaveCount(0);
    await reader.getByRole('searchbox', { name: '搜索题目', exact: true }).fill(content);
    const row = reader.getByRole('row').filter({ hasText: content });
    await expect(row).toBeVisible();
    expect(await reader.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await reader.screenshot({
      path: testInfo.outputPath('面试题库-窄屏-390x844.png'),
      fullPage: true,
    });
    const downloadPromise = reader.waitForEvent('download');
    await reader.getByRole('button', { name: '导出本模块', exact: true }).click();
    const download = await downloadPromise;
    const csvPath = testInfo.outputPath('面试题库-只读导出.csv');
    await download.saveAs(csvPath);
    expect(await readFile(csvPath, 'utf8')).toContain(answer);
    await row.getByRole('button', { name: '查看', exact: true }).click();
    const dialog = reader.getByRole('dialog');
    await expect(dialog).toContainText(content);
    await expect(dialog).toContainText(answer);
    const box = await dialog.boundingBox();
    if (!box) throw new Error('只读题目详情应当可见。');
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    await reader.screenshot({
      path: testInfo.outputPath('面试题库-详情-390x844.png'),
      fullPage: true,
    });
    const csrf = await (await reader.request.get('/api/v1/auth/csrf/')).json();
    const denied = await reader.request.post('/api/v1/question-templates/', {
      data: {
        request_key: crypto.randomUUID(),
        content: '只读角色不应创建的虚构题目',
        difficulty: '中等',
      },
      headers: { 'X-CSRFToken': csrf.csrfToken },
    });
    expect(denied.status()).toBe(403);
    await checkErrors();
  } finally {
    await context.close();
  }
});
