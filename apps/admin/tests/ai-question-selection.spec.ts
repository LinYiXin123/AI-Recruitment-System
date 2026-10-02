import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('AI题目逐题修改预览后分批真实入库，响应丢失重试不重复且余题可后续保存', async ({
  page,
}, testInfo) => {
  const run = `选题验收-${crypto.randomUUID()}`;
  const candidateName = `虚构人-${crypto.randomUUID()}`;
  const report = {
    summary: '仅用于独立验收库的虚构报告，没有真实候选人资料。',
    evidence: [],
    gaps: [],
    questions: [1, 2, 3].map((number) => ({
      question: `${run}-第${number}题：如何核实项目结果？`,
      reason: '核实验证方法。',
      follow_up: '请补充可核实的证据。',
      answer_points: ['说明目标与证据来源。'],
      quote: '',
    })),
    limitations: '虚构验收数据。',
  };
  // 只在隔离库创建报告，不调用模型，也不创建候选人或应聘记录。
  const seed = `
import base64, json, uuid
from django.conf import settings
from recruitment.models import AIScreening, Membership
database = settings.DATABASES['default']
assert database['NAME'] == 'recruitment_e2e'
assert database['HOST'] in ('127.0.0.1', 'localhost')
actor = Membership.objects.get(user__username='local_hr', active=True)
report = AIScreening.objects.create(
    organization=actor.organization, creator=actor, request_key=uuid.uuid4(),
    input_digest='0' * 64, candidate_name='${candidateName}', job_title='虚构选题验收岗位',
    result=json.loads(base64.b64decode('${Buffer.from(JSON.stringify(report)).toString('base64')}')),
)
print('E2E_REPORT_ID=' + str(report.pk))
`;
  const output = execFileSync(
    process.env.UV_BIN || 'uv',
    ['run', 'python', 'manage.py', 'shell', '-c', seed],
    {
      cwd: fileURLToPath(new URL('../../api/', import.meta.url)),
      env: {
        ...process.env,
        PGDATABASE: 'recruitment_e2e',
        PGHOST: '127.0.0.1',
        DJANGO_DEBUG: '1',
      },
      encoding: 'utf8',
    },
  );
  const reportId = output.match(/E2E_REPORT_ID=(\d+)/)?.[1];
  expect(reportId, '虚构报告应创建在本机独立验收库').toBeTruthy();
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('503'))
      consoleErrors.push(message.text());
  });
  await login(page);
  await page.getByRole('link', { name: 'AI 初面', exact: true }).click();
  const history = page.locator('.ai-history-table tbody tr').filter({ hasText: candidateName });
  await history.getByRole('button', { name: '查看', exact: true }).click();
  await page.getByRole('button', { name: '挑选题目入库', exact: true }).click();
  const selection = page.locator('dialog.ai-question-selection-dialog');
  await expect(selection.getByRole('article')).toHaveCount(3);
  await expect(
    selection.getByRole('button', { name: '预览已选题目（0）', exact: true }),
  ).toBeDisabled();
  await selection.getByRole('button', { name: '全选未入库题目', exact: true }).click();
  await selection.getByRole('checkbox', { name: '第 2 题', exact: true }).uncheck();
  const first = selection.getByRole('article', { name: '入库候选题目 1', exact: true });
  const editedContent = `${run}-修改后：请举例说明 <img src=x onerror="alert(1)"> 如何作为普通文本核对？`;
  const editedAnswer = '描述样本、判断标准和独立证据。\n<script>alert("纯文本")</script>';
  await first.getByLabel('题目内容', { exact: true }).fill(editedContent);
  await first.getByLabel('适用职位', { exact: true }).fill('虚构通用验证岗');
  await first.getByRole('combobox', { name: '考察维度', exact: true }).click();
  await selection.getByRole('option', { name: '逻辑思维' }).click();
  await first.getByRole('combobox', { name: '难度', exact: true }).click();
  await selection.getByRole('option', { name: '困难' }).click();
  await first.getByLabel('参考答案要点', { exact: true }).fill(editedAnswer);
  await selection.getByRole('button', { name: '预览已选题目（2）', exact: true }).click();
  await expect(selection).toHaveAccessibleName('预览入库题目');
  await expect(selection.getByRole('article')).toHaveCount(2);
  await expect(selection).toContainText(editedContent);
  await expect(selection).not.toContainText(report.questions[1].question);
  await expect(selection.locator('img, script')).toHaveCount(0);
  await selection.getByRole('button', { name: '返回修改', exact: true }).click();
  await expect(first.getByLabel('题目内容', { exact: true })).toHaveValue(editedContent);
  await selection.getByRole('button', { name: '预览已选题目（2）', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('AI选题-入库预览.png'), fullPage: true });

  const payloads: Array<{
    confirmed: boolean;
    questions: Array<{ index: number; content: string }>;
  }> = [];
  await page.route(`**/api/v1/ai-screenings/${reportId}/questions/`, async (route) => {
    payloads.push(route.request().postDataJSON());
    if (payloads.length === 1) {
      const persisted = await route.fetch();
      expect(persisted.ok(), await persisted.text()).toBeTruthy();
      return route.fulfill({
        status: 503,
        json: { errors: { detail: '入库响应暂时丢失，请重试。' } },
      });
    }
    return route.continue();
  });
  const stored = async () =>
    await (await page.request.get('/api/v1/question-templates/', { params: { q: run } })).json();
  await selection.getByRole('button', { name: '确认存入（2 题）', exact: true }).click();
  await expect(selection.getByRole('alert').filter({ hasText: '操作暂未完成' })).toContainText(
    '入库响应暂时丢失',
  );
  await expect(selection).toHaveAccessibleName('预览入库题目');
  await expect(selection).toContainText(editedAnswer);
  expect((await stored()).count).toBe(2);
  await selection.getByRole('button', { name: '确认存入（2 题）', exact: true }).click();
  await expect(selection.getByRole('status')).toContainText('已存入 2 道题');
  expect(payloads).toHaveLength(2);
  expect(payloads[1]).toEqual(payloads[0]);
  expect(payloads[0].questions.map((item) => item.index)).toEqual([0, 2]);
  const saved = await stored();
  expect(saved.count).toBe(2);
  expect(
    saved.items.find((item: { content: string }) => item.content === editedContent),
  ).toMatchObject({
    job_title: '虚构通用验证岗',
    dimension: '逻辑思维',
    difficulty: '困难',
    reference_answer: editedAnswer,
  });
  await expect(selection.getByRole('checkbox', { name: '第 1 题', exact: true })).toBeDisabled();
  await expect(selection.getByRole('checkbox', { name: '第 3 题', exact: true })).toBeDisabled();
  await expect(selection.getByRole('checkbox', { name: '第 2 题', exact: true })).toBeEnabled();
  await selection.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '挑选题目入库', exact: true }).click();
  await selection.getByRole('button', { name: '全选未入库题目', exact: true }).click();
  await expect(selection.getByRole('checkbox', { name: '第 2 题', exact: true })).toBeChecked();
  await selection.getByRole('button', { name: '预览已选题目（1）', exact: true }).click();
  await expect(selection.getByRole('article')).toHaveCount(1);
  await expect(selection).toContainText(report.questions[1].question);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await selection.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: testInfo.outputPath('AI选题-入库预览-390x844.png'),
    fullPage: true,
  });
  await selection.getByRole('button', { name: '确认存入（1 题）', exact: true }).click();
  await expect(selection.getByRole('status')).toContainText('已存入 1 道题');
  expect((await stored()).count).toBe(3);
  const refreshed = await (await page.request.get(`/api/v1/ai-screenings/${reportId}/`)).json();
  expect(refreshed.saved_question_count).toBe(3);
  expect(refreshed.questions).toEqual(report.questions);
  await expect(
    selection.getByRole('button', { name: '预览已选题目（0）', exact: true }),
  ).toBeDisabled();
  await testInfo.attach('控制台错误', {
    body: JSON.stringify(consoleErrors),
    contentType: 'application/json',
  });
  expect(consoleErrors).toEqual([]);
});
