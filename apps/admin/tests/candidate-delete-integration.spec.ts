import { expect, test } from '@playwright/test';
import type { Job, Me } from '../src/lib/api';
import type { Application } from '../src/lib/intake';
import { login } from './helpers';

test('新建虚构候选人后确认删除，刷新搜索不再出现且真实接口返回 404', async ({ page }) => {
  const name = `虚构删除端到端${Date.now()}`;
  await login(page);
  await page.getByRole('link', { name: '候选人', exact: true }).click();
  await page.getByRole('button', { name: '新增候选人', exact: true }).click();
  await page.locator('#new-candidate-name').fill(name);
  await page.locator('#new-candidate-email').fill(`candidate-delete-${Date.now()}@example.com`);
  const createdResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/candidates/') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const created = await createdResponse;
  expect(created.ok(), await created.text()).toBeTruthy();
  const { candidate } = await created.json();
  expect(candidate).toBeGreaterThan(0);
  await page.getByLabel('搜索候选人').fill(name);
  const row = page.getByRole('row').filter({ hasText: name });
  await row.getByRole('button', { name: '删除', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: '删除候选人', exact: true });
  await expect(confirmation).toContainText(name);
  const deletedResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/v1/candidates/${candidate}/`) &&
      response.request().method() === 'DELETE',
  );
  await confirmation.getByRole('button', { name: '确认删除', exact: true }).click();
  const deleted = await deletedResponse;
  expect(deleted.status(), await deleted.text()).toBe(200);
  expect(await deleted.json()).toEqual({ deleted: true });
  await expect(confirmation).toBeHidden();
  await expect(row).toHaveCount(0);
  await page.reload();
  await page.getByLabel('搜索候选人').fill(name);
  await expect(page.getByText('没有符合条件的候选人', { exact: true })).toBeVisible();
  await expect(row).toHaveCount(0);
  const detail = await page.request.get(`/api/v1/candidates/${candidate}/`);
  expect(detail.status()).toBe(404);
});

test('进行中应聘不能删，结束后可移出并从原应聘恢复同一主档', async ({ page }) => {
  const name = `虚构恢复端到端${Date.now()}`;
  await login(page);
  const csrf = await (await page.request.get('/api/v1/auth/csrf/')).json();
  async function post<T>(path: string, data: unknown): Promise<T> {
    const response = await page.request.post(`/api/v1/${path}`, {
      data,
      headers: { 'X-CSRFToken': csrf.csrfToken },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  }
  // 只在隔离验收服务创建本测试自己的虚构职位、主档和应聘，不调用 AI 或外部平台。
  const me: Me = await (await page.request.get('/api/v1/me/')).json();
  let job = await post<Job>('jobs/', {
    request_id: crypto.randomUUID(),
    title: name,
    department: me.departments[0].id,
    approver: me.departments[0].approvers[0].id,
    location: '深圳',
    headcount: 1,
  });
  job = await post<Job>(`jobs/${job.id}/profiles/`, {
    version: job.version,
    jd: '虚构验收岗位，不用于实际招聘。',
    source: '虚构验收',
    requirements: [{ kind: 'must', text: '完成虚构验收任务', needs_verification: false }],
    activate: true,
  });
  job = await post<Job>(`jobs/${job.id}/change-status/`, { version: job.version, status: 'open' });
  const saved = await post<{ candidate: number; application: number }>('candidates/', {
    request_key: crypto.randomUUID(),
    display_name: name,
    contact_note: '虚构验收资料',
    job: job.id,
  });
  await page.goto('/#candidates');
  await page.getByLabel('搜索候选人').fill(name);
  const row = page.getByRole('row').filter({ hasText: name });
  await row.getByRole('button', { name: '删除', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: '删除候选人', exact: true });
  await expect(confirmation).toContainText('条进行中的应聘');
  await expect(confirmation.getByRole('button', { name: '确认删除' })).toBeDisabled();
  await confirmation.getByRole('button', { name: '查看应聘' }).click();
  const detail = page.getByRole('dialog');
  await expect(detail).toContainText(`${name} · 第 1 次应聘`);
  await detail.getByRole('button', { name: '关闭详情', exact: true }).click();
  const application: Application = await (
    await page.request.get(`/api/v1/applications/${saved.application}/`)
  ).json();
  await post(`applications/${saved.application}/review/`, {
    version: application.version,
    profile: application.profile,
    request_key: crypto.randomUUID(),
    action: 'withdraw',
    reason: '仅结束本测试的虚构应聘，验证历史恢复。',
  });
  await page.reload();
  await page.getByLabel('搜索候选人').fill(name);
  await row.getByRole('button', { name: '删除', exact: true }).click();
  await confirmation.getByRole('button', { name: '确认删除' }).click();
  await expect(row).toHaveCount(0);

  await page.goto('/#talent-profiles');
  await page.getByLabel('搜索职位', { exact: true }).fill(name);
  await page
    .getByRole('row')
    .filter({ hasText: name })
    .getByRole('button', { name: '查看本职位应聘', exact: true })
    .click();
  await expect(row).toContainText('已移出候选人库');
  await expect(row).not.toContainText('原应聘待处理');
  await row.getByRole('button', { name: '处理原有应聘' }).click();
  await expect(detail).toContainText('这里保留的是已结束的应聘记录');
  await detail.getByRole('button', { name: '恢复到候选人库' }).click();
  await expect(detail).toContainText('已恢复到候选人库，原有应聘和材料保持不变。');
  await detail.getByRole('button', { name: '关闭详情', exact: true }).click();
  await expect(row).not.toContainText('已移出候选人库');
  await page.goto('/#candidates');
  await page.getByLabel('搜索候选人').fill(name);
  await expect(row).toHaveCount(1);
  await page.reload();
  await page.getByLabel('搜索候选人').fill(name);
  await expect(row).toHaveCount(1);
  const restored = await (await page.request.get(`/api/v1/candidates/${saved.candidate}/`)).json();
  expect(restored.id).toBe(saved.candidate);
  expect(restored.applications).toHaveLength(1);
  expect(restored.applications[0]).toMatchObject({ id: saved.application, stage: 'closed' });
});
