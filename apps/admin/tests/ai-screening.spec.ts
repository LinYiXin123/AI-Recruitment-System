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

test('导入简历附件后保留格式，分析时保留段落和链接地址', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'AI 初面' }).click();
  await page.route('**/api/v1/ai-screenings/extract/', (route) =>
    route.fulfill({
      json: {
        text: '项目经历\n开发检索工具。\n独立编写测试。\n项目文档',
        html: '<p><strong>项目经历</strong></p><div>开发检索工具。<br>独立编写测试。</div><p><a href="https://example.com/project">项目文档</a></p>',
      },
    }),
  );

  await page.getByLabel('导入简历附件').setInputFiles({
    name: 'resume.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: Buffer.from('fake DOCX'),
  });

  const editor = page.getByRole('textbox', { name: '简历内容' });
  await expect(editor.locator('strong')).toHaveText('项目经历');
  await expect(editor.getByRole('link', { name: '项目文档' })).toHaveAttribute('target', '_blank');
  await expect(page.getByRole('status')).toContainText('已识别 resume.docx');
  await page.route('**/api/v1/ai-screenings/', (route) =>
    route.fulfill({
      json: { summary: '已完成', evidence: [], gaps: [], questions: [], limitations: '' },
    }),
  );
  const submitted = page.waitForRequest('**/api/v1/ai-screenings/');
  await page.getByRole('button', { name: '开始分析', exact: true }).click();
  const text = (await submitted).postDataJSON().resume;
  expect(text).toContain('项目经历\n');
  expect(text).toContain('开发检索工具。\n独立编写测试。');
  expect(text).toContain('项目文档 (https://example.com/project)');
  await expect(page.getByText('已完成', { exact: true })).toBeVisible();
});

test('初面提纲包含题目、追问和回答要点，重新分析失败可保留结果并重试', async ({
  page,
  context,
}) => {
  await login(page);
  await page.getByRole('link', { name: 'AI 初面' }).click();
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const result = {
    summary: '虚构简历：有内部检索工具开发经验。',
    evidence: [{ criterion: '检索开发', quote: '开发内部检索工具', reason: '可核实项目实现。' }],
    gaps: [],
    questions: [
      {
        question: '如何验证检索结果的准确性？',
        reason: '核实评估方法。',
        follow_up: '测试样本如何选取，如何避免偏差？',
        answer_points: ['说明样本来源和标注方法。', '给出基线与改进结果。'],
        quote: '开发内部检索工具',
      },
    ],
    limitations: '请对照简历原文复核。',
  };
  let requests = 0;
  await page.route('**/api/v1/ai-screenings/', (route) => {
    requests += 1;
    expect(route.request().postDataJSON()).toMatchObject({
      application_id: null,
      job_id: null,
      enterprise_id: null,
      resume: '虚构简历：开发内部检索工具。',
    });
    return requests === 2
      ? route.fulfill({ status: 503, json: { errors: { detail: '模型服务网络连接失败或超时' } } })
      : route.fulfill({ json: result });
  });
  const resume = page.getByRole('textbox', { name: '简历内容' });
  await resume.fill('虚构简历：开发内部检索工具。');
  await page.getByRole('button', { name: '开始分析', exact: true }).click();
  const question = page.getByRole('article', { name: '第 1 题' });
  await expect(question).toContainText(result.questions[0].question);
  await expect(question).toContainText(result.questions[0].follow_up);
  await expect(question).toContainText('合格回答要点');
  await expect(question).toContainText(result.questions[0].answer_points[0]);
  await page.getByRole('button', { name: '复制提纲' }).click();
  await expect(page.getByRole('status')).toContainText('已复制面试提纲');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain('追问：测试样本如何选取，如何避免偏差？');
  expect(copied).toContain('给出基线与改进结果。');
  await page.getByRole('button', { name: '重新分析', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('模型服务网络连接失败或超时');
  await expect(page.getByRole('alert')).toContainText('上次分析结果仍保留');
  await expect(question).toBeVisible();
  await expect(resume).toHaveText('虚构简历：开发内部检索工具。');
  await page.getByRole('button', { name: '重试分析' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '重新分析', exact: true })).toBeEnabled();
  await expect(question).toBeVisible();
  expect(requests).toBe(3);
});

test('长分析结果固定在卡片内滚动，桌面等高且窄屏不撑高页面', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page);
  await page.getByRole('link', { name: 'AI 初面' }).click();
  await page.route('**/api/v1/ai-screenings/', (route) =>
    route.fulfill({
      json: {
        summary: '虚构简历：需进一步核实项目实施过程和测试结果。'.repeat(20),
        evidence: [],
        gaps: [],
        questions: Array.from({ length: 5 }, (_, index) => ({
          question: `第 ${index + 1} 个项目如何验证结果？`,
          reason: '核实本人职责、实施细节和结果依据。'.repeat(8),
          follow_up: '请说明样本选取、对照方法和异常处理过程。'.repeat(8),
          answer_points: Array.from({ length: 5 }, (_, point) =>
            `${point + 1}. 说明可复查的过程与证据。`.repeat(8),
          ),
          quote: '虚构项目经历。',
        })),
        limitations: '长结果滚动回归测试。',
      },
    }),
  );

  const cards = page.locator('.ai-screening-grid > .ai-screening-card');
  const result = page.locator('.ai-result-content');
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.getByRole('button', { name: '清空', exact: true }).click();
    await expect(page.getByText('尚未发起分析', { exact: true })).toBeVisible();
    const before = await cards.nth(1).boundingBox();
    if (!before) throw new Error('分析前未找到结果卡片。');
    await page.getByRole('textbox', { name: '简历内容' }).fill('虚构项目经历。');
    await page.getByRole('button', { name: '开始分析', exact: true }).click();
    await expect(page.getByRole('button', { name: '重新分析', exact: true })).toBeEnabled();

    const after = await cards.nth(1).boundingBox();
    if (!after) throw new Error('分析后未找到结果卡片。');
    expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(1);
    if (viewport.width > 760) {
      const form = await cards.nth(0).boundingBox();
      if (!form) throw new Error('未找到初面表单卡片。');
      expect(Math.abs(after.height - form.height)).toBeLessThanOrEqual(1);
    }
    await expect
      .poll(() => result.evaluate((element) => element.scrollHeight - element.clientHeight))
      .toBeGreaterThan(100);
    await expect(result).toHaveCSS('overscroll-behavior-y', 'contain');
    await result.scrollIntoViewIfNeeded();
    await result.focus();
    await expect(result).toBeFocused();
    const pagePosition = await page.evaluate(() => window.scrollY);
    const initialScroll = await result.evaluate((element) => element.scrollTop);
    await result.press('PageDown');
    await expect
      .poll(() => result.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(initialScroll);
    expect(await page.evaluate(() => window.scrollY)).toBe(pagePosition);

    await result.hover();
    const beforeWheel = await result.evaluate((element) => element.scrollTop);
    await page.mouse.wheel(0, 400);
    await expect
      .poll(() => result.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(beforeWheel);
    expect(await page.evaluate(() => window.scrollY)).toBe(pagePosition);
    await result.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await page.mouse.wheel(0, 400);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
    expect(await page.evaluate(() => window.scrollY)).toBe(pagePosition);
  }
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
