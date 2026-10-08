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

async function post(page: Page, path: string, data: unknown) {
  const csrf = await (await page.request.get('/api/v1/auth/csrf/')).json();
  const response = await page.request.post(`/api/v1/${path}`, {
    data,
    headers: { 'X-CSRFToken': csrf.csrfToken },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

async function createJob(page: Page, title: string) {
  await openJobs(page);
  await page.getByRole('button', { name: '新建职位', exact: true }).click();
  await page.getByLabel('职位名称').fill(title);
  await page.getByLabel('工作地点').fill('深圳');
  await page.getByLabel('招聘人数').fill('2');
  await page.getByLabel('用人负责人（用于澄清）').click();
  await page.getByRole('option', { name: /体验负责人/ }).click();
  await expect(page.getByLabel('用人负责人（用于澄清）')).toContainText('体验负责人');
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
  await expect(dialog.getByText('先填写基本需求，保存后继续整理招人要求。')).toHaveCount(0);
  await expect(dialog.getByLabel('所属企业')).toBeVisible();
  await expect(dialog.getByLabel('薪资区间')).toBeVisible();
  await expect(dialog.getByLabel('发布时间')).toHaveAttribute('type', 'date');
  expect((await page.getByLabel('职位名称').boundingBox())?.height).toBe(48);
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

test('职位列表展示保存后的建岗字段', async ({ page }) => {
  const title = '招聘专员（列表字段验收）';
  await login(page);
  await openJobs(page);
  await page.getByRole('button', { name: '新建职位', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('职位名称').fill(title);
  await dialog.getByLabel('所属企业').click();
  await page.getByRole('option', { name: /知遇体验团队（虚构）/ }).click();
  await dialog.getByLabel('职级').fill('主管级');
  await dialog.getByLabel('底薪').fill('7K');
  await dialog.getByLabel('绩效').fill('1K');
  await dialog.getByLabel('提成').fill('1K');
  await dialog.getByRole('button', { name: '按构成生成', exact: true }).click();
  await expect(dialog.getByLabel('薪资区间')).toHaveValue('底薪 7K + 绩效 1K + 提成 1K');
  await dialog.getByLabel('综合月薪').fill('8-9K');
  await dialog.getByLabel('招聘人数').fill('3');
  await dialog.getByLabel('发布时间').fill('2026-09-29');
  await dialog.getByLabel('工作地点').fill('深圳');
  await dialog.getByLabel('用人负责人（用于澄清）').click();
  await page.getByRole('option', { name: /体验负责人/ }).click();
  await dialog.getByLabel('任职要求').fill('一行一条，便于阅读');
  await page.screenshot({ path: 'test-results/职位完整字段弹窗.png' });
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await closeDetail(page);

  await expect(page.getByText('职位名称', { exact: true })).toBeVisible();
  await expect(page.getByText('所属部门', { exact: true })).toBeVisible();
  await expect(page.getByText('所属企业', { exact: true })).toBeVisible();
  await expect(page.getByText('职级', { exact: true })).toBeVisible();
  await expect(page.getByText('薪资区间', { exact: true })).toBeVisible();
  await expect(page.getByText('招聘人数', { exact: true })).toBeVisible();
  await expect(page.getByText('发布时间', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible();
  await expect(page.getByText('工作地点 · 深圳', { exact: true })).toBeVisible();
  await expect(page.getByText('产品研发部（虚构）', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('grid').getByText('知遇体验团队（虚构）', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('grid').getByText('主管级', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('grid').getByText('底薪 7K + 绩效 1K + 提成 1K', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('grid').getByText('3 人', { exact: true })).toBeVisible();
  await expect(page.getByRole('grid').getByText('2026-09-29', { exact: true })).toBeVisible();
  await expect(page.getByRole('grid').getByText('草稿', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/职位完整字段列表.png' });
});

async function fillRequirements(page: Page) {
  await page.getByRole('button', { name: '填写招人要求', exact: true }).click();
  await page
    .getByLabel('对外职位描述', { exact: true })
    .fill('负责招聘产品需求分析与协作流程设计。');
  await page.getByLabel('要求来源').fill('用人需求会议（虚构验收资料）');
  await page.getByLabel('具体要求 1').fill('能够独立完成用户访谈与需求分析');
  await page.getByRole('button', { name: '保存要求草稿' }).click();
  await expect(page.getByText('要求草稿已保存，暂不用于分析，可以继续修改。')).toBeVisible();
}
async function closeDetail(page: Page) {
  await page.getByRole('button', { name: '关闭详情' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test('HR 建岗后直接使用要求、招聘开启与版本保留', async ({ page, browser }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page);
  await createJob(page, '产品经理（流程验收）');
  await fillRequirements(page);
  await page.getByRole('button', { name: '使用此版本', exact: true }).click();
  await expect(page.getByText('此版本已生效，无需另外审批。')).toBeVisible();
  await page.screenshot({ path: '../../.local/验收-直接使用详情.png', fullPage: true });
  await closeDetail(page);
  await expect(
    page.getByRole('button', { name: '产品经理（流程验收）', exact: true }),
  ).toBeVisible();
  const managerContext = await browser.newContext();
  const manager = await managerContext.newPage();
  await login(manager, 'local_manager');
  await openJob(manager, '产品经理（流程验收）');
  await expect(manager.getByText('能够独立完成用户访谈与需求分析', { exact: true })).toBeVisible();
  await expect(manager.getByRole('button', { name: '确认招人要求', exact: true })).toHaveCount(0);
  await expect(manager.getByRole('button', { name: '使用此版本', exact: true })).toHaveCount(0);
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
  if (!(await page.getByLabel('具体要求 1').isVisible()))
    await page.getByLabel('展开或收起要求 1', { exact: true }).click();
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
  for (const name of ['按部门筛选职位', '按企业筛选职位', '按状态筛选职位']) {
    await expect(page.getByRole('combobox', { name, exact: true })).toBeVisible();
  }
  await page.getByLabel('按状态筛选职位', { exact: true }).click();
  await page.getByRole('option', { name: /关闭/ }).click();
  await expect(page.getByText('没有符合条件的职位')).toBeVisible();
  await page.getByRole('button', { name: '清空筛选' }).click();
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
  await expect(page.getByText('要求草稿已保存，暂不用于分析，可以继续修改。')).toBeVisible();
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

test('历史需补充版本由 HR 修改后直接使用，未保存编辑受保护', async ({ page, browser }) => {
  await login(page);
  await createJob(page, '设计师（补充流程验收）');
  await fillRequirements(page);
  await closeDetail(page);
  const found = await (
    await page.request.get('/api/v1/jobs/?search=设计师（补充流程验收）')
  ).json();
  let job = found.results[0];
  // 用兼容接口准备旧版待确认记录；新页面不再要求负责人审批。
  job = await post(page, `jobs/${job.id}/submit-profile/`, { version: job.version });
  const context = await browser.newContext();
  const manager = await context.newPage();
  await login(manager, 'local_manager');
  await post(manager, `jobs/${job.id}/review-profile/`, {
    version: job.version,
    outcome: 'changes_requested',
    note: '请写清楚设计协作经验的要求',
  });
  await page.reload();
  await openJob(page, '设计师（补充流程验收）');
  await page.screenshot({ path: '../../.local/验收-补充要求.png', fullPage: true });
  await expect(page.getByText('请写清楚设计协作经验的要求')).toBeVisible();
  await page.getByRole('button', { name: '调整要求' }).click();
  if (!(await page.getByLabel('具体要求 1').isVisible()))
    await page.getByLabel('展开或收起要求 1', { exact: true }).click();
  await page.getByLabel('具体要求 1').fill('有跨团队设计协作经验，能举出具体项目');
  const discardPrompt = page.waitForEvent('dialog');
  const closeAttempt = page.getByRole('button', { name: '关闭详情' }).click();
  const prompt = await discardPrompt;
  expect(prompt.message()).toContain('尚未保存');
  await prompt.dismiss();
  await closeAttempt;
  await expect(page.getByLabel('具体要求 1')).toHaveValue('有跨团队设计协作经验，能举出具体项目');
  await page.getByRole('button', { name: '保存并使用', exact: true }).click();
  await expect(page.getByText('招人要求已保存并使用，可以继续查看候选人的简历。')).toBeVisible();
  await closeDetail(page);
  await manager.reload();
  await openJob(manager, '设计师（补充流程验收）');
  await expect(manager.getByText('v2 · 已确认', { exact: true })).toBeVisible();
  await expect(manager.getByRole('button', { name: '确认招人要求', exact: true })).toHaveCount(0);
  await context.close();
});

test('建岗响应丢失后重试，只保留一条职位', async ({ page }) => {
  await login(page);
  await openJobs(page);
  await page.getByRole('button', { name: '新建职位', exact: true }).click();
  await page.getByLabel('职位名称').fill('幂等建岗（网络验收）');
  await page.getByLabel('工作地点').fill('深圳');
  await page.getByLabel('用人负责人（用于澄清）').click();
  await page.getByRole('option', { name: /体验负责人/ }).click();
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

test('澄清问题经负责人回答后仍需 HR 整理并明确使用', async ({ page, browser }) => {
  await login(page);
  await createJob(page, '招聘专员（澄清验收）');
  await page.getByRole('button', { name: '填写招人要求', exact: true }).click();
  await page.getByLabel('对外职位描述', { exact: true }).fill('负责招聘流程协作');
  await page.getByLabel('要求来源').fill('虚构澄清验收记录');
  await page.getByLabel('具体要求 1').fill('能够独立完成招聘需求分析');
  await page.getByLabel('这条招人要求还没确定').check();
  await page.getByRole('button', { name: '保存要求草稿' }).click();
  await expect(page.getByText('要求草稿已保存，暂不用于分析，可以继续修改。')).toBeVisible();
  await page.getByRole('tab', { name: '澄清问答', exact: true }).click();
  await page.getByLabel('需要澄清哪条要求（必填）').click();
  await page.getByRole('option', { name: /能够独立完成招聘需求分析/ }).click();
  await expect(page.getByLabel('需要澄清哪条要求（必填）')).toContainText(
    '能够独立完成招聘需求分析',
  );
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
  await expect(manager.getByText('答复已保存，HR 将核对要求后自行保存并使用。')).toBeVisible();
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
  if (!(await page.getByLabel('具体要求 1').isVisible()))
    await page.getByLabel('展开或收起要求 1', { exact: true }).click();
  await page.getByLabel('具体要求 1').fill('能够独立完成技术岗位的需求访谈和岗位分析');
  await page.getByLabel('这条招人要求还没确定').uncheck();
  await page.getByRole('button', { name: '保存要求草稿' }).click();
  await expect(page.getByText('要求草稿已保存，暂不用于分析，可以继续修改。')).toBeVisible();
  await page.getByRole('button', { name: '使用此版本', exact: true }).click();
  await expect(page.getByText('此版本已生效，无需另外审批。')).toBeVisible();
  await page.getByRole('tab', { name: '澄清问答', exact: true }).click();
  await expect(page.getByText('能够独立完成技术岗位的需求访谈和岗位分析。')).toBeVisible();
  await expect(page.getByText('v1', { exact: true })).toBeVisible();
  await closeDetail(page);
  await context.close();
});
