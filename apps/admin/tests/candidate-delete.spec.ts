import { expect, type Page, type Route, test } from '@playwright/test';

function candidate(id: number, canDelete = true) {
  return {
    id,
    display_name: `虚构删除验收人${id}`,
    phone: '',
    email: '',
    contact_note: '虚构界面验收资料',
    current_city: '泉州',
    education_level: '本科',
    work_years: '4 年',
    expected_salary: '12-15K',
    source: '猎聘',
    applications: [],
    can_delete: canDelete,
    updated_at: '2026-10-09T00:00:00Z',
  };
}

async function openCandidates(page: Page, records = [candidate(99001), candidate(99002, false)]) {
  const state = {
    records,
    loads: [] as number[],
    deletions: [] as { id: number; body: unknown; csrf: string | undefined }[],
    pending: [] as Route[],
    hold: false,
    fail: false,
    unexpected: [] as string[],
  };
  async function finishDelete(route: Route) {
    if (state.fail)
      return route.fulfill({ status: 503, json: { errors: { detail: '删除失败，请稍后重试。' } } });
    const id = Number(new URL(route.request().url()).pathname.split('/').at(-2));
    state.records = state.records.filter((record) => record.id !== id);
    return route.fulfill({ json: { deleted: true } });
  }
  // 全部 API 使用虚构数据；验证浏览器请求与展示契约，真实数据库删除由后端测试覆盖。
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === '/api/v1/auth/csrf/')
      return route.fulfill({ json: { csrfToken: 'candidate-delete-csrf', home_url: '/' } });
    if (path === '/api/v1/me/')
      return route.fulfill({
        json: {
          name: '虚构删除验收 HR',
          avatar_url: '',
          auth_source: 'local',
          organization: '虚构验收组织',
          roles: ['hr'],
          departments: [],
        },
      });
    if (path === '/api/v1/applications/filter-options/')
      return route.fulfill({ json: { jobs: [], sources: [] } });
    if (path === '/api/v1/candidates/' && request.method() === 'GET') {
      const current = Number(url.searchParams.get('page') || 1);
      state.loads.push(current);
      return route.fulfill({
        json: {
          count: state.records.length,
          next: current * 20 < state.records.length ? `?page=${current + 1}` : null,
          previous: current > 1 ? `?page=${current - 1}` : null,
          results: state.records.slice((current - 1) * 20, current * 20),
        },
      });
    }
    if (/^\/api\/v1\/candidates\/\d+\/$/.test(path) && request.method() === 'DELETE') {
      state.deletions.push({
        id: Number(path.split('/').at(-2)),
        body: request.postDataJSON(),
        csrf: request.headers()['x-csrftoken'],
      });
      if (state.hold) state.pending.push(route);
      else await finishDelete(route);
      return;
    }
    state.unexpected.push(`${request.method()} ${path}`);
    return route.fulfill({ status: 500, json: { errors: { detail: '未预期的验收请求' } } });
  });
  await page.goto('/#candidates');
  await expect(page.getByRole('heading', { name: '候选人库', exact: true })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: records[0].display_name })).toBeVisible();
  return { state, finishDelete };
}

test('窄屏删除红字在详情右侧，无权限隐藏，取消不删且成功后刷新保留结果', async ({ page }) => {
  await page.setViewportSize({ width: 1013, height: 984 });
  const { state } = await openCandidates(page);
  const person = state.records[0];
  const row = page.getByRole('row').filter({ hasText: person.display_name });
  const protectedRow = page.getByRole('row').filter({ hasText: state.records[1].display_name });
  await expect(protectedRow.getByRole('button', { name: '删除', exact: true })).toHaveCount(0);
  await expect(protectedRow.getByRole('button', { name: '详情', exact: true })).toHaveCount(1);
  await page.locator('.candidate-library-panel .semi-table-body').evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  const detail = row.getByRole('button', { name: '详情', exact: true });
  const remove = row.getByRole('button', { name: '删除', exact: true });
  await expect(detail).toBeInViewport();
  await expect(remove).toBeInViewport();
  const detailBox = await detail.boundingBox();
  const removeBox = await remove.boundingBox();
  if (!detailBox || !removeBox) throw new Error('详情与删除按钮应同时可见');
  expect(removeBox.x).toBeGreaterThanOrEqual(detailBox.x + detailBox.width);
  expect(Math.abs(removeBox.y - detailBox.y)).toBeLessThan(4);
  await expect(remove).toHaveCSS('color', 'rgb(180, 35, 50)');
  await expect(remove).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await remove.click();
  const dialog = page.getByRole('dialog', { name: '删除候选人', exact: true });
  await expect(dialog).toContainText(`确定删除「${person.display_name}」吗？`);
  await expect(dialog).toContainText('已有应聘、面试记录保留，进行中的流程不会自动终止。');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(state.deletions).toHaveLength(0);
  await expect(row).toBeVisible();
  const previousLoads = state.loads.length;
  await remove.click();
  await dialog.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(row).toHaveCount(0);
  await expect(page.getByText('共 1 条 · 第 1 页', { exact: true })).toBeVisible();
  expect(state.deletions).toEqual([
    { id: person.id, body: { updated_at: person.updated_at }, csrf: 'candidate-delete-csrf' },
  ]);
  expect(state.loads.length).toBeGreaterThan(previousLoads);
  await page.reload();
  await expect(page.getByText('共 1 条 · 第 1 页', { exact: true })).toBeVisible();
  await expect(row).toHaveCount(0);
  await expect(protectedRow).toBeVisible();
  expect(state.unexpected).toEqual([]);
});

test('删除中不能重复确认或 Escape 关闭，失败保留条目与错误并允许重试', async ({ page }) => {
  const { state, finishDelete } = await openCandidates(page);
  const person = state.records[0];
  const row = page.getByRole('row').filter({ hasText: person.display_name });
  state.hold = true;
  state.fail = true;
  await row.getByRole('button', { name: '删除', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '删除候选人', exact: true });
  await dialog.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect.poll(() => state.pending.length).toBe(1);
  await expect(dialog.getByRole('button', { name: /确认删除|正在删除/ })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeDisabled();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  expect(state.deletions).toHaveLength(1);
  const pending = state.pending.shift();
  if (!pending) throw new Error('应存在等待返回的删除请求');
  await finishDelete(pending);
  await expect(dialog.getByRole('alert')).toContainText('删除失败，请稍后重试。');
  await expect(dialog.getByRole('button', { name: '确认删除', exact: true })).toBeEnabled();
  await expect(row).toBeVisible();
  await expect(page.getByText('共 2 条 · 第 1 页', { exact: true })).toBeVisible();
  state.hold = false;
  state.fail = false;
  await dialog.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(row).toHaveCount(0);
  expect(state.deletions).toHaveLength(2);
  expect(state.deletions[1]).toEqual(state.deletions[0]);
  expect(state.unexpected).toEqual([]);
});

test('删除第 2 页最后一条后回到第 1 页并同步人数', async ({ page }) => {
  const records = Array.from({ length: 21 }, (_, index) => candidate(99100 + index));
  const { state } = await openCandidates(page, records);
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.getByText('共 21 条 · 第 2 页', { exact: true })).toBeVisible();
  const last = records[20];
  const row = page.getByRole('row').filter({ hasText: last.display_name });
  await row.getByRole('button', { name: '删除', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '删除候选人', exact: true });
  await dialog.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('共 20 条 · 第 1 页', { exact: true })).toBeVisible();
  await expect(row).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: records[0].display_name })).toBeVisible();
  await expect(page.getByRole('button', { name: '上一页', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '下一页', exact: true })).toBeDisabled();
  expect(state.deletions).toEqual([
    { id: last.id, body: { updated_at: last.updated_at }, csrf: 'candidate-delete-csrf' },
  ]);
  expect(state.loads).toContain(2);
  expect(state.loads.at(-1)).toBe(1);
  expect(state.unexpected).toEqual([]);
});
