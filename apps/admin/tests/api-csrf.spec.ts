import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('另一标签页重新登录后，原页面写请求无需刷新且不再使用旧 CSRF', async ({ page, context }) => {
  await login(page);
  await expect(page.getByRole('link', { name: '人才画像', exact: true })).toBeVisible();
  const second = await context.newPage();
  await login(second);
  await second.close();

  const outcome = await page.evaluate(async () => {
    // Vite 加载原页面已经使用的共享模块；不提取或返回任何 Cookie/凭证。
    const modulePath = '/src/lib/api.ts';
    const { api, ApiError }: typeof import('../src/lib/api') = await import(
      /* @vite-ignore */ modulePath
    );
    try {
      // 故意使用无效 UUID：通过真实会话和 CSRF 后由字段校验拒绝，不调用模型、不建岗。
      await api('jobs/profile-ai/', { jd: '虚构测试岗位需求', request_key: 'invalid-test-uuid' });
      return { status: 200, message: '' };
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      return { status: error.status, message: error.message };
    }
  });
  expect(outcome.status).toBe(400);
  expect(outcome.message).not.toContain('CSRF');
});
