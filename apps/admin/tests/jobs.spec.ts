import { expect, type Page, test } from '@playwright/test';
import { login } from './helpers';

async function openJobs(page: Page) {
  const menu = page.getByRole('button', { name: '菜单' });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('link', { name: '职位', exact: true }).click();
}

async function openJob(page: Page, title: string) {
  await openJobs(page);
  await page.getByRole('button', { name: title, exact: true }).click();
}

async function createJob(page: Page, title: string) {
  await openJobs(page);
  await page.getByRole('button', { name: '新建职位', exact: true }).click();
  await page.getByLabel('职位名称').fill(title);
  await page.getByLabel('工作地点').fill('深圳');
  await page.getByLabel('计划招聘人数').fill('2');
  await page.getByLabel('招人要求确认人').selectOption({ label: '体验负责人' });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
}

test('新建职位以居中弹窗显示必填标题和固定操作区', async ({ page }) => {
  await page.setViewportSize({ width: 896, height: 738 });
  await login(page);
  await openJobs(page);
  await page.getByRole('button', { name: '新建职位', exact: true }).click();

  const dialog = page.getByRole('dialog');
  const form = dialog.locator('#create-job-form');
  const footer = dialog.locator('[data-slot="sheet-footer"]');
  await expect(dialog).toHaveClass(/job-create-dialog/);
  expect(
    await page.getByLabel('职位名称').evaluate((element) => (element as HTMLInputElement).required),
  ).toBe(true);
  await expect(dialog.locator('.job-required-mark')).toHaveText('*');
  await expect(footer.getByRole('button', { name: '取消', exact: true })).toBeVisible();
  await expect(footer.getByRole('button', { name: '保存', exact: true })).toBeVisible();
  expect(await form.evaluate((element) => getComputedStyle(element).overflowY)).toBe('auto');
  expect(
    await form.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
  ).toBeTruthy();
  await page.screenshot({ path: 'test-results/新建职位弹窗.png' });

  await footer.getByRole('button', { name: '取消', exact: true }).click();
  await expect(dialog).toHaveCount(0);
});
async function fillRequirements(page: Page) {
  await page.getByRole('button', { name: '填写招人要求', exact: true }).click();
  await page
    .getByLabel('对外职位描述', { exact: true })
    .fill('负责招聘产品需求分析与协作流程设计。');
  await page.getByLabel('要求来源').fill('用人需求会议（虚构验收资料）');
  await page.getByLabel('具体要求 1').fill('能够独立完成用户访谈与需求分析');
  await page.getByRole('button', { name: '保存要求草稿' }).click();
  await expect(page.getByText('新版本已保存。提交后将由负责人确认。')).toBeVisible();
}
async function closeDetail(page: Page) {
  await page.getByRole('button', { name: '关闭详情' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test('HR 建岗、负责人确认、招聘开启与版本保留', async ({ page, browser }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page);
  await createJob(page, '产品经理（流程验收）');
  await fillRequirements(page);
  await page.getByRole('button', { name: '提交确认', exact: true }).click();
  await expect(page.getByText('已提交，等待用人负责人确认。')).toBeVisible();
  await page.screenshot({ path: '../../.local/验收-待确认详情.png', fullPage: true });
  await closeDetail(page);
  await expect(
    page.getByRole('button', { name: '产品经理（流程验收）', exact: true }),
  ).toBeVisible();
  const managerContext = await browser.newContext();
  const manager = await managerContext.newPage();
  await login(manager, 'local_manager');
  await openJob(manager, '产品经理（流程验收）');
  await manager.getByRole('button', { name: '确认招人要求', exact: true }).click();
  await expect(manager.getByText('招人要求已确认，相关待办已完成。')).toBeVisible();
  await closeDetail(manager);
  await expect(
    manager.getByRole('button', { name: '产品经理（流程验收）', exact: true }),
  ).toBeVisible();
  await managerContext.close();
  await page.reload();
  await page.getByRole('link', { name: '职位', exact: true }).click();
  await page.getByRole('button', { name: '产品经理（流程验收）', exact: true }).click();
  await page.getByRole('button', { name: '开始招聘', exact: true }).click();
  await expect(page.getByText('职位已开始招聘。')).toBeVisible();
  await page.getByRole('button', { name: '调整要求' }).click();
  await page.getByLabel('具体要求 1').fill('更新后的要求，仅用于新版');
  await page.getByRole('button', { name: '保存要求草稿' }).click();
  await page.getByRole('tab', { name: '版本与记录' }).click();
  await page.getByText('v1 · 已确认', { exact: false }).click();
  await expect(page.getByText('能够独立完成用户访谈与需求分析')).toBeVisible();
  await closeDetail(page);
  await page.reload();
  await expect(
    page.getByRole('button', { name: '产品经理（流程验收）', exact: true }),
  ).toBeVisible();
  await page.getByLabel('职位状态', { exact: true }).selectOption('closed');
  await expect(page.getByText('没有符合条件的职位')).toBeVisible();
  await page.getByRole('button', { name: '清除筛选' }).click();
  await expect(
    page.getByRole('button', { name: '产品经理（流程验收）', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: '../../.local/验收-职位列表.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('失败后保留表单、恢复保存与窄屏操作', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await createJob(page, '招聘专员（失败恢复验收）');
  await page.getByRole('button', { name: '填写招人要求', exact: true }).click();
  await page.getByLabel('对外职位描述', { exact: true }).fill('整理招聘需求。');
  await page.getByLabel('要求来源').fill('虚构会议记录');
  await page.getByLabel('具体要求 1').fill('了解招聘流程');
  let releaseSave = () => {};
  const saving = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  await page.route('**/api/v1/jobs/*/profiles/', async (route) => {
    if (route.request().method() === 'POST') {
      await saving;
      await route.abort();
    } else await route.continue();
  });
  await page.getByRole('button', { name: '保存要求草稿' }).click();
  await expect(page.getByRole('button', { name: '正在保存…', exact: true })).toBeDisabled();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '关闭详情' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('具体要求 1')).toHaveValue('了解招聘流程');
  releaseSave();
  await expect(page.getByRole('alert')).toContainText('暂时连接不上服务');
  await expect(page.getByLabel('具体要求 1')).toHaveValue('了解招聘流程');
  await page.unroute('**/api/v1/jobs/*/profiles/');
  await page.getByRole('button', { name: '保存要求草稿' }).click();
  await expect(page.getByText('新版本已保存。提交后将由负责人确认。')).toBeVisible();
  await page.screenshot({ path: '../../.local/验收-窄屏详情.png', fullPage: true });
  expect(
    await page.locator('.sheet-scroll').evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBeTruthy();
  const tabBox = await page.getByRole('tablist').boundingBox();
  expect(tabBox?.height).toBeLessThan(60);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('未授权 HR 看不到他人职位，退出后返回公共首页', async ({ page }) => {
  await login(page, 'local_other_hr');
  await page.getByRole('link', { name: '职位', exact: true }).click();
  await expect(page.getByText('从第一个职位开始')).toBeVisible();
  await page.getByLabel('搜索职位或地点').fill('产品经理');
  await expect(page.getByText('没有符合条件的职位')).toBeVisible();
  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page).toHaveURL('http://127.0.0.1:5176/');
  await page.reload();
  await expect(page.getByRole('link', { name: '开启知遇之旅' })).toBeVisible();
  expect((await page.request.get('/api/v1/me/')).status()).toBe(403);
});

test('负责人要求补充后，HR 待办完成并重新送审', async ({ page, browser }) => {
  await login(page);
  await createJob(page, '设计师（补充流程验收）');
  await fillRequirements(page);
  await page.getByRole('button', { name: '提交确认', exact: true }).click();
  await expect(page.getByText('已提交，等待用人负责人确认。')).toBeVisible();
  await closeDetail(page);
  const context = await browser.newContext();
  const manager = await context.newPage();
  await login(manager, 'local_manager');
  await openJob(manager, '设计师（补充流程验收）');
  await manager.getByLabel('确认备注 / 需补充内容').fill('请写清楚设计协作经验的要求');
  const discardPrompt = manager.waitForEvent('dialog');
  const closeAttempt = manager.getByRole('button', { name: '关闭详情' }).click();
  const prompt = await discardPrompt;
  expect(prompt.message()).toContain('尚未保存');
  await prompt.dismiss();
  await closeAttempt;
  await expect(manager.getByLabel('确认备注 / 需补充内容')).toHaveValue(
    '请写清楚设计协作经验的要求',
  );
  await manager.getByRole('button', { name: '请 HR 补充' }).click();
  await expect(manager.getByText('已记录需要补充的内容，HR 可修改后重新提交。')).toBeVisible();
  await page.reload();
  await openJob(page, '设计师（补充流程验收）');
  await page.screenshot({ path: '../../.local/验收-补充要求.png', fullPage: true });
  await expect(page.getByText('请写清楚设计协作经验的要求')).toBeVisible();
  await page.getByRole('button', { name: '调整要求' }).click();
  await page.getByLabel('具体要求 1').fill('有跨团队设计协作经验，能举出具体项目');
  await page.getByRole('button', { name: '保存要求草稿' }).click();
  await expect(page.getByText('新版本已保存。提交后将由负责人确认。')).toBeVisible();
  await page.getByRole('button', { name: '提交确认', exact: true }).click();
  await expect(page.getByText('已提交，等待用人负责人确认。')).toBeVisible();
  await closeDetail(page);
  await manager.reload();
  await manager.getByRole('button', { name: '设计师（补充流程验收）', exact: true }).click();
  await expect(manager.getByText('v2 · 待确认', { exact: true })).toBeVisible();
  await expect(manager.getByRole('button', { name: '确认招人要求', exact: true })).toBeVisible();
  await context.close();
});

test('建岗响应丢失后重试，只保留一条职位', async ({ page }) => {
  await login(page);
  await openJobs(page);
  await page.getByRole('button', { name: '新建职位', exact: true }).click();
  await page.getByLabel('职位名称').fill('幂等建岗（网络验收）');
  await page.getByLabel('工作地点').fill('深圳');
  await page.getByLabel('招人要求确认人').selectOption({ label: '体验负责人' });
  await page.route('**/api/v1/jobs/', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fetch();
      await route.abort();
    } else await route.continue();
  });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('暂时连接不上服务');
  await page.unroute('**/api/v1/jobs/');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '幂等建岗（网络验收）', exact: true }),
  ).toBeVisible();
  const response = await page.request.get('/api/v1/jobs/?search=幂等建岗');
  expect((await response.json()).count).toBe(1);
});

test('澄清问题经负责人回答后仍需整理与正式确认', async ({ page, browser }) => {
  await login(page);
  await createJob(page, '招聘专员（澄清验收）');
  await page.getByRole('button', { name: '填写招人要求', exact: true }).click();
  await page.getByLabel('对外职位描述', { exact: true }).fill('负责招聘流程协作');
  await page.getByLabel('要求来源').fill('虚构澄清验收记录');
  await page.getByLabel('具体要求 1').fill('能够独立完成招聘需求分析');
  await page.getByLabel('此项仍需核实，不能直接作为淘汰依据').check();
  await page.getByRole('button', { name: '保存要求草稿' }).click();
  await expect(page.getByText('新版本已保存。提交后将由负责人确认。')).toBeVisible();
  await page.getByRole('tab', { name: '澄清问答', exact: true }).click();
  await page.getByLabel('需要澄清哪条要求（必填）').selectOption({ index: 1 });
  await page.getByLabel('想向负责人了解什么（必填）').fill('需要独立负责哪类招聘项目？');
  await page.route('**/api/v1/jobs/*/clarifications/', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fetch();
      await route.abort();
    } else await route.continue();
  });
  await page.getByRole('button', { name: '提交澄清问题' }).click();
  await expect(page.getByRole('alert')).toContainText('暂时连接不上服务');
  await expect(page.getByLabel('想向负责人了解什么（必填）')).toHaveValue(
    '需要独立负责哪类招聘项目？',
  );
  await page.unroute('**/api/v1/jobs/*/clarifications/');
  await page.getByRole('button', { name: '提交澄清问题' }).click();
  await expect(page.getByText('问题已交给负责人，工作台待办已创建。')).toBeVisible();
  await expect(page.getByRole('heading', { name: '需要独立负责哪类招聘项目？' })).toHaveCount(1);
  await closeDetail(page);
  const context = await browser.newContext();
  const manager = await context.newPage();
  await login(manager, 'local_manager');
  await openJob(manager, '招聘专员（澄清验收）');
  await manager.getByRole('tab', { name: '澄清问答', exact: true }).click();
  await expect(manager.getByRole('tab', { name: '澄清问答' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await manager.getByRole('button', { name: '回答这个问题' }).click();
  await manager.getByLabel('你的答复（必填）').fill('能够独立完成技术岗位的需求访谈和岗位分析。');
  const leavePrompt = manager.waitForEvent('dialog');
  const switchTab = manager.getByRole('tab', { name: '招人要求', exact: true }).click();
  const unsavedDialog = await leavePrompt;
  expect(unsavedDialog.message()).toContain('尚未保存');
  await unsavedDialog.dismiss();
  await switchTab;
  await expect(manager.getByLabel('你的答复（必填）')).toHaveValue(
    '能够独立完成技术岗位的需求访谈和岗位分析。',
  );
  await manager.getByRole('button', { name: '保存答复' }).click();
  await expect(manager.getByText('答复已保存，HR 将整理要求后再提交正式确认。')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '招聘专员（澄清验收）', exact: true }).click();
  await page.getByRole('tab', { name: '澄清问答', exact: true }).click();
  await expect(page.getByText('能够独立完成技术岗位的需求访谈和岗位分析。')).toBeVisible();
  for (const width of [390, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.locator('.sheet-scroll').evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBeTruthy();
    await page.screenshot({ path: `../../.local/验收-澄清问答-${width}.png`, fullPage: true });
  }
  await page.getByRole('tab', { name: '招人要求', exact: true }).click();
  await expect(
    page.getByRole('tabpanel', { name: '招人要求' }).getByText('v1 · 草稿', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '开始招聘', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '调整要求' }).click();
  await page.getByLabel('具体要求 1').fill('能够独立完成技术岗位的需求访谈和岗位分析');
  await page.getByLabel('此项仍需核实，不能直接作为淘汰依据').uncheck();
  await page.getByRole('button', { name: '保存要求草稿' }).click();
  await expect(page.getByText('新版本已保存。提交后将由负责人确认。')).toBeVisible();
  await page.getByRole('button', { name: '提交确认', exact: true }).click();
  await expect(page.getByText('已提交，等待用人负责人确认。')).toBeVisible();
  await page.getByRole('tab', { name: '澄清问答', exact: true }).click();
  await expect(page.getByText('能够独立完成技术岗位的需求访谈和岗位分析。')).toBeVisible();
  await expect(page.getByText('v1', { exact: true })).toBeVisible();
  await closeDetail(page);
  await context.close();
});
