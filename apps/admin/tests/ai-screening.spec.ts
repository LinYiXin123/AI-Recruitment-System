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
      '选择候选人后自动填充其「简历原文」，可覆盖修改；也可导入 PDF、DOCX、TXT 或 MD（≤10MB），或直接粘贴原文。扫描件和图片暂不支持 OCR。',
    ),
  ).toBeVisible();
  await expect(page.getByText(/点击分析会将简历文本/)).toHaveCount(0);
  await expect(page.getByText('分析不提供录用或淘汰结论，也不会自动评分。')).toHaveCount(0);

  const runButton = page.getByRole('button', { name: '开始分析' });
  const clearButton = page.getByRole('button', { name: '清空' });
  await expect(runButton).toHaveCSS('height', '36px');
  await expect(clearButton).toHaveCSS('height', '36px');
});

test('导入简历附件后将识别出的文字填入简历内容', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'AI 初面' }).click();
  await page.route('**/api/v1/ai-screenings/extract/', (route) =>
    route.fulfill({ json: { text: '已识别的简历正文。' } }),
  );

  await page.getByLabel('导入简历附件').setInputFiles({
    name: 'resume.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: Buffer.from('fake DOCX'),
  });

  await expect(page.getByLabel('简历内容')).toHaveValue('已识别的简历正文。');
  await expect(page.getByRole('status')).toContainText('已识别 resume.docx');
});

test('简历中的网址可单击并在新标签页打开', async ({ page, context }) => {
  await login(page);
  await page.getByRole('link', { name: 'AI 初面' }).click();
  await context.route('https://github.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: 'test destination' }),
  );

  await page.locator('#ai-resume').evaluate((element) => {
    element.focus();
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', '项目地址：github.com/huige66631');
    element.dispatchEvent(
      new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }),
    );
  });

  const link = page.locator('#ai-resume a[href="https://github.com/huige66631"]');
  await expect(link).toHaveAttribute('target', '_blank');
  const newTab = context.waitForEvent('page');
  await link.click();
  const opened = await newTab;
  await expect(opened).toHaveURL('https://github.com/huige66631');
  await opened.close();
});
