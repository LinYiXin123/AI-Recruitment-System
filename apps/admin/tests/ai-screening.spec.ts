import { expect, test } from '@playwright/test';
import { login } from './helpers';

const screeningCollection = /\/api\/v1\/ai-screenings\/(?:\?.*)?$/;
const savedAnalysis = {
  id: 901,
  code: 'AIS-0901',
  created_at: '2026-10-02T01:30:00Z',
  candidate_name: '虚构测试人选',
  job_title: '虚构检索开发岗位',
  enterprise_name: '虚构测试企业',
  match_score: 72,
  conclusion: '待复核',
  saved_question_count: 0,
  question_count: 1,
  summary: '简历列出了检索工具的实现经历，需要进一步核实测试过程。',
  evidence: [{ criterion: '项目实现', quote: '开发内部检索工具', reason: '对应检索开发经历。' }],
  gaps: [{ criterion: '评估依据', note: '简历未说明测试样本及标注方法。' }],
  questions: [
    {
      question: '如何验证检索结果的准确性？',
      reason: '核实评估方法。',
      follow_up: '测试样本如何选取，如何避免偏差？',
      answer_points: ['说明样本来源和标注方法。', '给出基线与改进结果。'],
      quote: '开发内部检索工具',
    },
  ],
  follow_up_direction: '重点核实测试样本来源与个人负责的实现细节。',
  limitations: '请结合原始项目材料人工复核。',
};
const savedQuestionDraft = {
  index: 0,
  content: savedAnalysis.questions[0].question,
  job_title: savedAnalysis.job_title,
  dimension: '',
  difficulty: '中等',
  reference_answer: savedAnalysis.questions[0].answer_points.join('\n'),
  saved: false,
  deleted: false,
};

test.beforeEach(async ({ page }) => {
  await page.route(screeningCollection, (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ json: { items: [], count: 0, page: 1, page_size: 20 } })
      : route.fallback(),
  );
});

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
  await expect(page.getByRole('status').filter({ hasText: '已识别 resume.docx' })).toBeVisible();
  await page.route(screeningCollection, (route) =>
    route.request().method() !== 'POST'
      ? route.fallback()
      : route.fulfill({
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
  await page.route(screeningCollection, (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
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
  await expect(question).toContainText('合格');
  await expect(question).toContainText(result.questions[0].answer_points[0]);
  await expect(page.locator('.ai-result-content')).toContainText('待复核');
  await expect(page.locator('.ai-report-score')).toContainText('—');
  await expect(page.locator('.ai-result-content')).not.toContainText('undefined');
  await expect(page.getByRole('button', { name: '挑选题目入库' })).toBeDisabled();
  await page.getByRole('button', { name: '复制提纲' }).click();
  await expect(page.locator('.ai-result-content').getByRole('status')).toContainText(
    '已复制面试提纲',
  );
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

test('完整分析按参考结构呈现，题目经确认入库且失败可重试', async ({ page }) => {
  let savedCount = 0;
  let saveRequests = 0;
  let releaseSave!: () => void;
  const savePending = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  await page.route(screeningCollection, (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ json: savedAnalysis })
      : route.fulfill({
          json: {
            items: [{ ...savedAnalysis, saved_question_count: savedCount }],
            count: 1,
            page: 1,
            page_size: 20,
          },
        }),
  );
  await page.route('**/api/v1/ai-screenings/901/questions/', async (route) => {
    expect(route.request().method()).toBe('POST');
    const { saved: _saved, deleted: _deleted, ...question } = savedQuestionDraft;
    expect(route.request().postDataJSON()).toEqual({ confirmed: true, questions: [question] });
    saveRequests += 1;
    if (saveRequests === 1) {
      await savePending;
      return route.fulfill({ status: 503, json: { errors: { detail: '题库保存失败，请重试。' } } });
    }
    savedCount = 1;
    return route.fulfill({ json: { saved_question_count: 1, question_ids: [1001] } });
  });
  await page.route('**/api/v1/ai-screenings/901/', (route) =>
    route.fulfill({
      json: {
        ...savedAnalysis,
        saved_question_count: savedCount,
        questions_saved: savedCount > 0,
        question_drafts: [{ ...savedQuestionDraft, saved: savedCount > 0 }],
      },
    }),
  );
  await login(page);
  await page.getByRole('link', { name: 'AI 初面' }).click();
  await page.getByRole('textbox', { name: '简历内容' }).fill('虚构简历：开发内部检索工具。');
  await page.getByRole('button', { name: '开始分析', exact: true }).click();

  const result = page.locator('.ai-result-content');
  await expect(result).toContainText('72');
  await expect(result).toContainText('待复核');
  await expect(result).toContainText(savedAnalysis.job_title);
  await expect(result).toContainText('2026');
  await expect(result.getByRole('heading', { name: '匹配理由', exact: true })).toBeVisible();
  await expect(result).toContainText(savedAnalysis.summary);
  const evidence = result.locator('details');
  await expect(evidence.locator('blockquote')).toBeHidden();
  await evidence.locator('summary').click();
  await expect(evidence.locator('blockquote')).toHaveText(savedAnalysis.evidence[0].quote);
  await expect(result.getByRole('heading', { name: '风险点', exact: true })).toBeVisible();
  await expect(result).toContainText(savedAnalysis.gaps[0].note);
  const question = result.getByRole('article', { name: '第 1 题' });
  await expect(question).toContainText(savedAnalysis.questions[0].question);
  await expect(question).toContainText(savedAnalysis.questions[0].reason);
  await expect(question).toContainText(savedAnalysis.questions[0].follow_up);
  await expect(question).toContainText(savedAnalysis.questions[0].answer_points[1]);
  await expect(result.getByRole('heading', { name: '建议追问方向', exact: true })).toBeVisible();
  await expect(result).toContainText(savedAnalysis.follow_up_direction);
  await expect(result.getByRole('button', { name: '复制提纲' })).toBeEnabled();

  const save = result.getByRole('button', { name: '挑选题目入库' });
  await save.click();
  const confirmation = page.locator('dialog.ai-question-selection-dialog');
  await expect(confirmation).toContainText('本组织题库');
  await confirmation.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(confirmation).toBeHidden();
  expect(saveRequests).toBe(0);
  await save.click();
  await confirmation.getByRole('checkbox', { name: '第 1 题', exact: true }).check();
  await confirmation.getByRole('button', { name: '预览已选题目（1）', exact: true }).click();
  await expect(confirmation).toHaveAccessibleName('预览入库题目');
  await expect(confirmation).toContainText('本组织有题库查看权限的成员可见');
  await confirmation.getByRole('button', { name: '确认存入（1 题）', exact: true }).click();
  await expect(confirmation.getByRole('button', { name: '正在存入…' })).toBeDisabled();
  await expect(confirmation.getByRole('button', { name: '返回修改', exact: true })).toBeDisabled();
  await confirmation.press('Escape');
  await expect(confirmation).toBeVisible();
  releaseSave();
  await expect(confirmation.getByRole('alert').filter({ hasText: '操作暂未完成' })).toContainText(
    '题库保存失败，请重试。',
  );
  await expect(result.getByRole('article', { name: '第 1 题', includeHidden: true })).toContainText(
    savedAnalysis.questions[0].question,
  );
  await confirmation.getByRole('button', { name: '确认存入（1 题）', exact: true }).click();
  await expect(confirmation.getByRole('status')).toContainText('已存入 1 道题');
  await expect(confirmation.getByRole('checkbox', { name: '第 1 题', exact: true })).toBeDisabled();
  await confirmation.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(confirmation).toBeHidden();
  await expect(result.getByRole('alert')).toHaveCount(0);
  await expect(result.getByRole('button', { name: '挑选题目入库' })).toBeEnabled();
  expect(saveRequests).toBe(2);
  const bankLink = result.getByRole('link', { name: '查看面试题库' });
  await expect(bankLink).toHaveCSS('display', 'inline-block');
  await bankLink.click();
  await expect(page).toHaveURL(/#question-bank$/);
});

test('历史支持服务端分页、刷新后查看与确认删除，失败保留记录', async ({ page }) => {
  let records = Array.from({ length: 21 }, (_, index) => ({
    ...savedAnalysis,
    id: 901 + index,
    code: `AIS-${901 + index}`,
    candidate_name: `虚构历史人选 ${index + 1}`,
    match_score: index === 20 ? null : savedAnalysis.match_score,
    conclusion: index === 20 ? '通用初判' : savedAnalysis.conclusion,
    job_title: index === 20 ? '' : savedAnalysis.job_title,
    enterprise_name: index === 20 ? '' : savedAnalysis.enterprise_name,
  }));
  const last = records[20];
  const requestedPages: number[] = [];
  let viewRequests = 0;
  let deleteRequests = 0;
  let releaseDelete!: () => void;
  const deletePending = new Promise<void>((resolve) => {
    releaseDelete = resolve;
  });
  await page.route(screeningCollection, (route) => {
    expect(route.request().method()).toBe('GET');
    const currentPage = Number(new URL(route.request().url()).searchParams.get('page') || '1');
    requestedPages.push(currentPage);
    return route.fulfill({
      json: {
        items: records.slice((currentPage - 1) * 20, currentPage * 20),
        count: records.length,
        page: currentPage,
        page_size: 20,
      },
    });
  });
  await page.route('**/api/v1/ai-screenings/921/', async (route) => {
    if (route.request().method() === 'DELETE') {
      deleteRequests += 1;
      if (deleteRequests === 1) {
        await deletePending;
        return route.fulfill({ status: 503, json: { errors: { detail: '删除失败，请重试。' } } });
      }
      records = records.filter((record) => record.id !== last.id);
      return route.fulfill({ status: 204 });
    }
    expect(route.request().method()).toBe('GET');
    viewRequests += 1;
    return route.fulfill({ json: last });
  });
  await login(page);
  await page.getByRole('link', { name: 'AI 初面' }).click();
  const history = page.getByRole('region', { name: '历史分析记录' });
  await expect(history.getByRole('columnheader')).toHaveText([
    '候选人',
    '目标职位',
    '企业',
    '结论',
    '匹配度',
    '分析时间',
    '问题数',
    '操作',
  ]);
  await expect(history.getByRole('button', { name: '上一页' })).toBeDisabled();
  await history.getByRole('button', { name: '下一页' }).click();
  const lastRow = history.getByRole('row').filter({ hasText: last.candidate_name });
  await expect(lastRow).toBeVisible();
  await expect(history.getByRole('button', { name: '下一页' })).toBeDisabled();
  expect(requestedPages).toContain(2);

  await page.reload();
  await expect(page.getByText('尚未发起分析', { exact: true })).toBeVisible();
  await history.getByRole('button', { name: '下一页' }).click();
  const resume = page.getByRole('textbox', { name: '简历内容' });
  await resume.fill('当前正在编辑的虚构简历，不应被历史记录替换。');
  await lastRow.getByRole('button', { name: '查看', exact: true }).click();
  const result = page.locator('.ai-result-content');
  await expect(result).toContainText(last.summary);
  await expect(result.getByRole('status')).toContainText(`历史分析记录 ${last.code}`);
  await expect(result.getByRole('status')).toContainText(`候选人：${last.candidate_name}`);
  await expect(result.getByRole('status')).toContainText('目标企业：未指定企业');
  await expect(result.getByRole('status')).toContainText('仅查看历史；左侧输入未替换');
  await expect(page.getByRole('button', { name: '分析当前简历', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '重新分析', exact: true })).toHaveCount(0);
  await expect(result).toContainText('通用初判');
  await expect(result.locator('.ai-report-score')).toContainText('—');
  await expect(result).not.toContainText('undefined');
  await expect(resume).toHaveText('当前正在编辑的虚构简历，不应被历史记录替换。');
  await expect(result.getByRole('article', { name: '第 1 题' })).toContainText(
    last.questions[0].follow_up,
  );
  expect(viewRequests).toBe(1);

  await lastRow.getByRole('button', { name: '删除', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: '删除分析记录' });
  await expect(confirmation).toContainText(last.code);
  await expect(confirmation).toContainText('不会删除已存入题库的题目');
  await confirmation.getByRole('button', { name: '取消', exact: true }).click();
  await expect(confirmation).toBeHidden();
  expect(deleteRequests).toBe(0);
  await expect(lastRow).toBeVisible();
  await lastRow.getByRole('button', { name: '删除', exact: true }).click();
  await confirmation.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(confirmation.getByRole('button', { name: '正在删除…' })).toBeDisabled();
  await expect(confirmation.getByRole('button', { name: '取消', exact: true })).toBeDisabled();
  releaseDelete();
  await expect(confirmation.getByRole('alert')).toContainText('删除失败，请重试。');
  await expect(
    page.locator('.ai-history-table tbody tr').filter({ hasText: last.candidate_name }),
  ).toHaveCount(1);
  await expect(result.locator('article')).toContainText(last.questions[0].question);
  await confirmation.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(confirmation).toBeHidden();
  await expect(lastRow).toHaveCount(0);
  await expect(history).toContainText('共 20 条');
  await expect(history.getByRole('button', { name: '上一页' })).toBeDisabled();
  await expect(history.getByRole('button', { name: '下一页' })).toBeDisabled();
  expect(deleteRequests).toBe(2);
});

test.describe('初面输入与历史记录隔离', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/applications/?page=*', (route) =>
      route.fulfill({
        json: {
          results: [{ id: 101, candidate: 201, name: '虚构候选人' }],
          next: null,
          count: 1,
          previous: null,
        },
      }),
    );
    await page.route('**/api/v1/jobs/?page=*', (route) =>
      route.fulfill({
        json: {
          results: [{ id: 301, title: '虚构目标职位' }],
          next: null,
          count: 1,
          previous: null,
        },
      }),
    );
    await page.route('**/api/v1/employer-brand/enterprises/ai-options/', (route) =>
      route.fulfill({ json: [] }),
    );
  });

  for (const action of ['清空', '编辑', '导入', '切换候选人', '离开页面'] as const) {
    test(`${action}后取消历史请求，迟到结果不覆盖当前输入`, async ({ page }) => {
      let releaseHistory = () => {};
      const pending = new Promise<void>((resolve) => {
        releaseHistory = resolve;
      });
      await page.route(screeningCollection, (route) =>
        route.fulfill({
          json: { items: [savedAnalysis], count: 1, page: 1, page_size: 20 },
        }),
      );
      await page.route('**/api/v1/ai-screenings/901/', async (route) => {
        await pending;
        await route.fulfill({ json: savedAnalysis });
      });
      await page.route('**/api/v1/applications/101/', (route) =>
        route.fulfill({ json: { resumes: [{ parse: { text: '虚构候选人的新简历。' } }] } }),
      );
      await login(page);
      await page.getByRole('link', { name: 'AI 初面' }).click();
      const editor = page.getByRole('textbox', { name: '简历内容' });
      await editor.fill('原有虚构简历。');
      const historyRequest = page.waitForRequest('**/api/v1/ai-screenings/901/');
      await page
        .getByRole('region', { name: '历史分析记录' })
        .getByRole('button', { name: '查看', exact: true })
        .click();
      const request = await historyRequest;
      const cancelled = page.waitForEvent('requestfailed', (failed) => failed === request);
      let expectedText = '';
      if (action === '清空') {
        await page.getByRole('button', { name: '清空', exact: true }).click();
      } else if (action === '编辑') {
        expectedText = '正在编辑的新虚构简历。';
        await editor.fill(expectedText);
      } else if (action === '导入') {
        expectedText = '刚导入的新虚构简历。';
        await page.getByLabel('导入简历附件').setInputFiles({
          name: 'new-resume.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from(expectedText),
        });
      } else if (action === '切换候选人') {
        expectedText = '虚构候选人的新简历。';
        await page.locator('#ai-candidate').click();
        await page.getByRole('option', { name: '虚构候选人', exact: true }).click();
      } else {
        await page.getByRole('link', { name: '今天', exact: true }).click();
      }
      await cancelled;
      releaseHistory();
      if (action === '离开页面') {
        await page.getByRole('link', { name: 'AI 初面' }).click();
      }
      await expect(editor).toHaveText(expectedText);
      await expect(page.locator('.ai-result-content')).not.toContainText(savedAnalysis.summary);
      await expect(page.getByText('尚未发起分析', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: '开始分析', exact: true })).toBeEnabled();
    });
  }

  test('候选人和职位可分别取消，保留简历并中断候选人读取', async ({ page }) => {
    let releaseResume = () => {};
    const pending = new Promise<void>((resolve) => {
      releaseResume = resolve;
    });
    await page.route('**/api/v1/applications/101/', async (route) => {
      await pending;
      await route.fulfill({
        json: { resumes: [{ parse: { text: '不应迟到覆盖的候选人简历。' } }] },
      });
    });
    let submitted: Record<string, unknown> | undefined;
    await page.route(screeningCollection, (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      submitted = route.request().postDataJSON();
      return route.fulfill({ json: savedAnalysis });
    });
    await login(page);
    await page.getByRole('link', { name: 'AI 初面' }).click();
    const editor = page.getByRole('textbox', { name: '简历内容' });
    await editor.fill('需要保留的虚构简历。');
    await page.locator('#ai-job').click();
    await page.getByRole('option', { name: '虚构目标职位', exact: true }).click();
    const sourceRequest = page.waitForRequest('**/api/v1/applications/101/');
    await page.locator('#ai-candidate').click();
    await page.getByRole('option', { name: '虚构候选人', exact: true }).click();
    const request = await sourceRequest;
    const cancelled = page.waitForEvent('requestfailed', (failed) => failed === request);
    await page.locator('#ai-candidate').click();
    await page.getByRole('option', { name: '请选择候选人（可留空）', exact: true }).click();
    await cancelled;
    releaseResume();
    await expect(editor).toHaveText('需要保留的虚构简历。');
    await expect(page.locator('#ai-job')).toContainText('虚构目标职位');
    await page.locator('#ai-job').click();
    await page.getByRole('option', { name: '请选择职位（可留空）', exact: true }).click();
    await expect(editor).toHaveText('需要保留的虚构简历。');
    await page.getByRole('button', { name: '开始分析', exact: true }).click();
    await expect(page.locator('.ai-result-content')).toContainText(savedAnalysis.summary);
    expect(submitted).toMatchObject({
      application_id: null,
      job_id: null,
      resume: '需要保留的虚构简历。',
    });
  });
});

test('网络失败沿用请求编号，编号冲突后下次手动重试使用新编号', async ({ page }) => {
  const keys: string[] = [];
  await page.route(screeningCollection, (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    keys.push(route.request().postDataJSON().request_key);
    if (keys.length === 1) return route.abort('failed');
    if (keys.length === 2)
      return route.fulfill({
        status: 409,
        json: { errors: { detail: '请求编号已失效，请重试。' } },
      });
    return route.fulfill({ json: savedAnalysis });
  });
  await login(page);
  await page.getByRole('link', { name: 'AI 初面' }).click();
  await page.getByRole('textbox', { name: '简历内容' }).fill('虚构简历：开发内部检索工具。');
  await page.getByRole('button', { name: '开始分析', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('暂时连接不上服务');
  await page.getByRole('button', { name: '重试分析', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('请求编号已失效');
  await page.getByRole('button', { name: '重试分析', exact: true }).click();
  await expect(page.locator('.ai-result-content')).toContainText(savedAnalysis.summary);
  expect(keys).toHaveLength(3);
  expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
  expect(keys[1]).toBe(keys[0]);
  expect(keys[2]).not.toBe(keys[1]);
});

test('附件识别失败保留简历和已有报告，成功替换附件才清除报告', async ({ page }) => {
  let releaseImport = () => {};
  const pending = new Promise<void>((resolve) => {
    releaseImport = resolve;
  });
  await page.route(screeningCollection, (route) =>
    route.request().method() === 'POST' ? route.fulfill({ json: savedAnalysis }) : route.fallback(),
  );
  await page.route('**/api/v1/ai-screenings/extract/', async (route) => {
    await pending;
    await route.fulfill({ status: 503, json: { errors: { detail: '附件识别暂时失败。' } } });
  });
  await login(page);
  await page.getByRole('link', { name: 'AI 初面' }).click();
  const editor = page.getByRole('textbox', { name: '简历内容' });
  await editor.fill('原有虚构简历：开发内部检索工具。');
  await page.getByRole('button', { name: '开始分析', exact: true }).click();
  const result = page.locator('.ai-result-content');
  await expect(result).toContainText(savedAnalysis.summary);
  await page.getByLabel('导入简历附件').setInputFiles({
    name: 'failed.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('fake PDF'),
  });
  await expect(result.getByRole('button', { name: '挑选题目入库' })).toBeDisabled();
  await expect(result).toContainText(savedAnalysis.summary);
  releaseImport();
  await expect(page.getByRole('alert')).toContainText('附件识别暂时失败');
  await expect(editor).toHaveText('原有虚构简历：开发内部检索工具。');
  await expect(result).toContainText(savedAnalysis.summary);
  await expect(result.getByRole('button', { name: '挑选题目入库' })).toBeEnabled();
  await expect(page.getByRole('button', { name: '重新分析', exact: true })).toBeEnabled();
  await page.getByLabel('导入简历附件').setInputFiles({
    name: 'new-resume.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('新导入的虚构简历。'),
  });
  await expect(editor).toHaveText('新导入的虚构简历。');
  await expect(result).not.toContainText(savedAnalysis.summary);
  await expect(page.getByText('尚未发起分析', { exact: true })).toBeVisible();
});

test('历史题目全部在题库删除后不允许再次入库，仍可前往题库', async ({ page }) => {
  await page.route(screeningCollection, (route) =>
    route.fulfill({
      json: { items: [savedAnalysis], count: 1, page: 1, page_size: 20 },
    }),
  );
  await page.route('**/api/v1/ai-screenings/901/', (route) =>
    route.fulfill({
      json: {
        ...savedAnalysis,
        questions_saved: true,
        saved_question_count: 0,
        question_drafts: [{ ...savedQuestionDraft, deleted: true }],
      },
    }),
  );
  await login(page);
  await page.getByRole('link', { name: 'AI 初面' }).click();
  await page
    .getByRole('region', { name: '历史分析记录' })
    .getByRole('button', { name: '查看', exact: true })
    .click();
  const result = page.locator('.ai-result-content');
  await result.getByRole('button', { name: '挑选题目入库', exact: true }).click();
  const selection = page.locator('dialog.ai-question-selection-dialog');
  await expect(selection.getByRole('checkbox', { name: '第 1 题', exact: true })).toBeDisabled();
  await expect(selection).toContainText('已从题库删除，不可重复入库');
  await expect(
    selection.getByRole('button', { name: '预览已选题目（0）', exact: true }),
  ).toBeDisabled();
  await selection.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(result.getByRole('link', { name: '查看面试题库' })).toHaveAttribute(
    'href',
    '#question-bank',
  );
  await expect(result.getByRole('button', { name: '复制提纲' })).toBeEnabled();
  await expect(result.getByRole('status').filter({ hasText: '历史分析记录' })).toContainText(
    `目标企业：${savedAnalysis.enterprise_name}`,
  );
});

test('长分析结果固定在卡片内滚动，桌面等高且窄屏不撑高页面', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page);
  await page.getByRole('link', { name: 'AI 初面' }).click();
  await page.route(screeningCollection, (route) =>
    route.request().method() !== 'POST'
      ? route.fallback()
      : route.fulfill({
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
