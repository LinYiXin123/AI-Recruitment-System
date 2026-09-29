import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('AI 初面表单与结果区等高，操作按钮和附件说明符合页面样式', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page);
  await page.getByRole('link', { name: 'AI 初面' }).click();

  const cards = page.locator('.ai-screening-grid > .ai-screening-card');
  await expect(cards).toHaveCount(2);
  const formBox = await cards.nth(0).boundingBox();
  const resultBox = await cards.nth(1).boundingBox();
  expect(formBox).not.toBeNull();
  expect(resultBox).not.toBeNull();
  expect(Math.abs(formBox!.height - resultBox!.height)).toBeLessThanOrEqual(1);

  await expect(
    page.getByText(
      '选择候选人后自动填充其「简历原文」，可覆盖修改；也可导入简历附件（PDF / Word / 图片，≤10MB）或直接拖入文本文件。',
    ),
  ).toBeVisible();
  await expect(page.getByText(/点击分析会将简历文本/)).toHaveCount(0);
  await expect(page.getByText('分析不提供录用或淘汰结论，也不会自动评分。')).toHaveCount(0);

  const runButton = page.getByRole('button', { name: '开始分析' });
  const clearButton = page.getByRole('button', { name: '清空' });
  await expect(runButton).toHaveCSS('height', '36px');
  await expect(clearButton).toHaveCSS('height', '36px');
});
