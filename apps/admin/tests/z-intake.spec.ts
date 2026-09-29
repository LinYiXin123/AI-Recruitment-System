import { expect, type Page, test } from '@playwright/test';
import { login } from './helpers';

async function post(page: Page, path: string, body: unknown) {
  const config = await (await page.request.get('/api/v1/auth/csrf/')).json();
  const r = await page.request.post(`/api/v1/${path}`, {
    data: body,
    headers: { 'X-CSRFToken': config.csrfToken },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  return r.json();
}
function pdf(text = '') {
  const stream = text ? `BT /F1 12 Tf 40 100 Td (${text}) Tj ET` : '';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let content = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((o, i) => {
    offsets.push(content.length);
    content += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const start = content.length;
  content += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)
    .join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(content);
}

test('候选人录入表单使用统一下拉与日期日历', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: '候选人', exact: true }).click();
  await page.getByRole('button', { name: '新增候选人', exact: true }).click();
  const sourceSelect = page.locator('#new-candidate-source');
  await expect
    .poll(() =>
      sourceSelect.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          height: style.height,
          maxHeight: style.maxHeight,
          overflowY: style.overflowY,
          borderRadius: style.borderRadius,
        };
      }),
    )
    .toEqual({ height: '42px', maxHeight: '42px', overflowY: 'hidden', borderRadius: '10px' });
  await page.locator('#new-candidate-gender').click();
  await page.getByText('女', { exact: true }).click();
  await expect(page.locator('#new-candidate-gender')).toContainText('女');
  await sourceSelect.click();
  await expect(page.getByText('内推', { exact: true })).toBeVisible();
  await page.getByText('内推', { exact: true }).click();
  const today = new Date();
  const todayLabel = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  await page.getByRole('button', { name: '选择预计入职日期' }).click();
  await page.getByRole('button', { name: todayLabel, exact: true }).click();
  await expect(page.getByRole('button', { name: '选择预计入职日期' })).toContainText(todayLabel);
  await page.getByRole('button', { name: '清除预计入职日期' }).click();
  await expect(page.getByRole('button', { name: '选择预计入职日期' })).toContainText(
    '选择预计入职日期',
  );
});

test('导入真实文字、失败恢复、人工复核、多人多次应聘与待办直达', async ({ page, browser }) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page);
  const me = await (await page.request.get('/api/v1/me/')).json();
  let job = await post(page, 'jobs/', {
    request_id: crypto.randomUUID(),
    title: '进人闭环验收岗',
    location: '深圳',
    headcount: 2,
    department: me.departments[0].id,
    approver: me.departments[0].approvers[0].id,
  });
  job = await post(page, `jobs/${job.id}/profiles/`, {
    version: job.version,
    jd: '负责用户访谈',
    source: '虚构验收需求',
    requirements: [{ kind: 'must', text: '具备访谈经验' }],
  });
  job = await post(page, `jobs/${job.id}/submit-profile/`, { version: job.version });
  const mc = await browser.newContext();
  const manager = await mc.newPage();
  await login(manager, 'local_manager');
  job = await post(manager, `jobs/${job.id}/review-profile/`, {
    version: job.version,
    outcome: 'confirm',
  });
  await mc.close();
  await post(page, `jobs/${job.id}/change-status/`, { version: job.version, status: 'open' });
  await page.getByRole('link', { name: '候选人', exact: true }).click();
  await page.getByRole('button', { name: '导入简历', exact: true }).click();
  await page.getByLabel('目标职位', { exact: true }).selectOption(String(job.id));
  await page.getByLabel('材料来源', { exact: true }).fill('本人提供的虚构验收材料');
  await page.getByLabel('简历文件', { exact: true }).setInputFiles([
    {
      name: 'fictional-resume.pdf',
      mimeType: 'application/pdf',
      buffer: pdf('Fictional resume: conducted user interviews.'),
    },
    { name: 'fictional-scan.pdf', mimeType: 'application/pdf', buffer: pdf() },
  ]);
  await page.getByRole('button', { name: '开始导入', exact: true }).click();
  await expect(page.getByText('已接收 2 / 2 份，已核对 0 份')).toBeVisible();
  await expect(page.getByText('提取失败', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '核对与继续', exact: true }).first().click();
  await expect(
    page.getByText('Fictional resume: conducted user interviews.', { exact: false }),
  ).toBeVisible();
  await page.getByLabel('姓名（人工核对）').fill('虚构林一');
  await page.getByLabel('联系方式缺失说明').fill('等待本人补充');
  await page.getByRole('button', { name: '查找疑似重复' }).click();
  await expect(page.getByText('授权范围内暂未找到疑似重复')).toBeVisible();
  // 丢失已提交响应后，原样重试不能重复创建人才或应聘。
  let dropped = false;
  await page.route('**/items/*/confirm/', async (route) => {
    if (!dropped) {
      dropped = true;
      await route.fetch();
      await route.abort();
    } else await route.continue();
  });
  await page.getByRole('button', { name: '确认身份并进入应聘' }).click();
  await expect(page.getByText('暂时连接不上服务', { exact: false })).toBeVisible();
  await expect(page.getByLabel('姓名（人工核对）')).toHaveValue('虚构林一');
  await page.getByRole('button', { name: '确认身份并进入应聘' }).click();
  await expect(page.getByText('已接收 2 / 2 份，已核对 1 份')).toBeVisible();
  await page.getByRole('button', { name: '核对与继续' }).click();
  await page
    .getByLabel('人工摘录（请写明页码或来源）')
    .fill('人工摘录第 1 页：另一份同名材料，经历不同，尚未核实。');
  await page.getByRole('button', { name: '保存人工摘录版本' }).click();
  await expect(page.getByText('文字版本 v2 · 人工摘录', { exact: false })).toBeVisible();
  await page.getByLabel('姓名（人工核对）').fill('虚构林一');
  await page.getByLabel('联系方式缺失说明').fill('材料缺少电话');
  await page.getByRole('button', { name: '查找疑似重复' }).click();
  await expect(page.getByText('发现 1 个疑似主档，请人工核对')).toBeVisible();
  await page.getByLabel('核对依据 / 同名区分依据').fill('同名但项目与来源不同，人工确认是另一人');
  await page.getByRole('button', { name: '确认身份并进入应聘' }).click();
  await expect(page.getByText('已接收 2 / 2 份，已核对 2 份')).toBeVisible();
  await page.getByRole('button', { name: '打开本次应聘' }).first().click();
  await expect(page.getByText('AI 评估尚未接通')).toBeVisible();
  await page.getByLabel('处理结果').selectOption('need_info');
  await page.getByLabel('依据与说明').fill('缺少联系方式，材料缺失不作不通过判断');
  await page.getByLabel('接手 HR').selectOption({ label: '体验 HR' });
  await page.getByLabel('跟进期限（本机时区）').fill('2099-01-01T10:00');
  await page.getByRole('button', { name: '提交人工处理结果' }).click();
  await expect(page.getByText('处理结果已保存，相关待办已更新。')).toBeVisible();
  await page.getByLabel('处理结果').selectOption('supplement');
  await page.getByLabel('依据与说明').fill('本人电话补齐项目范围，来源为人工核对记录。');
  await page.getByRole('button', { name: '提交人工处理结果' }).click();
  await page.getByLabel('处理结果').selectOption('advance');
  await page.getByLabel('依据与说明').fill('据第 1 页访谈项目推进面试，具体能力仍需面试验证');
  await page.getByRole('button', { name: '提交人工处理结果' }).click();
  await expect(
    page.getByRole('dialog').locator('[data-slot="badge"]').filter({ hasText: '待安排面试' }),
  ).toBeVisible();
  for (const width of [390, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.getByRole('dialog').evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBeTruthy();
    await page.screenshot({ path: `../../.local/验收-D02-应聘详情-${width}.png`, fullPage: true });
  }
  await page.getByRole('button', { name: '关闭详情' }).click();
  await page.getByRole('link', { name: '候选人', exact: true }).click();
  await page.getByRole('tab', { name: '应聘记录' }).click();
  await page.getByLabel('搜索候选人').fill('虚构林一');
  await page
    .getByRole('row')
    .filter({ hasText: '进人闭环验收岗' })
    .filter({ hasText: '待安排面试' })
    .getByRole('button', { name: '虚构林一', exact: true })
    .click();
  await expect(
    page.getByRole('dialog').locator('[data-slot="badge"]').filter({ hasText: '待安排面试' }),
  ).toBeVisible();
  await page.getByRole('button', { name: '关闭详情' }).click();
  await page.getByRole('tab', { name: '人才档案' }).click();
  await expect(page.getByRole('button', { name: '虚构林一', exact: true })).toHaveCount(2);
  await page.reload();
  await page.getByRole('tab', { name: '导入记录' }).click();
  await page.getByRole('button', { name: '进人闭环验收岗', exact: true }).click();
  await expect(page.getByText('已接收 2 / 2 份，已核对 2 份')).toBeVisible();
  await page.getByRole('button', { name: '关闭详情' }).click();
  await page.getByRole('tab', { name: '人才档案' }).click();
  await page.getByRole('button', { name: '虚构林一', exact: true }).first().click();
  await page.getByLabel('目标职位', { exact: true }).selectOption(String(job.id));
  await page.getByLabel('应聘来源', { exact: true }).fill('再次人工加入同一职位');
  await page.getByRole('button', { name: '建立或打开本次应聘' }).click();
  await expect(page.getByRole('heading', { name: '虚构林一 · 第 1 次应聘' })).toBeVisible();
  await page.getByLabel('处理结果').selectOption('reject');
  await page.getByLabel('依据与说明').fill('本次项目经验与职位要求不符，仅结束这一次应聘');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: '关闭详情' }).click();
  await expect(page.getByLabel('依据与说明')).toHaveValue(
    '本次项目经验与职位要求不符，仅结束这一次应聘',
  );
  await page.getByRole('button', { name: '提交人工处理结果' }).click();
  await expect(page.getByText('本次结束原因：', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '关闭详情' }).click();
  await page.getByRole('button', { name: '虚构林一', exact: true }).first().click();
  await page.getByLabel('目标职位', { exact: true }).selectOption(String(job.id));
  await page.getByLabel('应聘来源', { exact: true }).fill('后续再次投递');
  await page.getByRole('button', { name: '建立或打开本次应聘' }).click();
  await expect(page.getByRole('heading', { name: '虚构林一 · 第 2 次应聘' })).toBeVisible();
  await page.getByLabel('依据与说明').fill('冲突后仍保留这段人工核对说明');
  const apps = await (await page.request.get('/api/v1/applications/')).json();
  const current = apps.results.find((a: { attempt_no: number }) => a.attempt_no === 2);
  const full = await (await page.request.get(`/api/v1/applications/${current.id}/`)).json();
  await post(page, `applications/${full.id}/review/`, {
    version: full.version,
    profile: full.profile,
    request_key: crypto.randomUUID(),
    action: 'need_info',
    reason: '另一个窗口已要求补齐材料',
    followup_owner: full.handlers[0].id,
    due_at: '2099-01-01T10:00:00+08:00',
  });
  await page.getByRole('button', { name: '提交人工处理结果' }).click();
  await expect(page.getByText('记录已经更新', { exact: false })).toBeVisible();
  await expect(page.getByLabel('依据与说明')).toHaveValue('冲突后仍保留这段人工核对说明');
  await page.getByRole('button', { name: '重新加载' }).click();
  await expect(page.getByText('另一个窗口已要求补齐材料')).toBeVisible();
  await expect(page.getByLabel('依据与说明')).toHaveValue('冲突后仍保留这段人工核对说明');
  await page.getByRole('button', { name: '提交人工处理结果' }).click();
  await expect(
    page.getByRole('dialog').locator('[data-slot="badge"]').filter({ hasText: '待安排面试' }),
  ).toBeVisible();
  await page.getByLabel('面试轮次').fill('1');
  await page
    .getByLabel('本轮目标')
    .fill('核实需求分析方法与跨团队协作经历，具体能力留待面试中判断。');
  await page.getByLabel('开始时间（北京时间）').fill('2099-01-02T10:00');
  await page.getByLabel('结束时间（北京时间）').fill('2099-01-02T11:00');
  await page.getByLabel('面试地点').fill('深圳南山区会议室 A');
  await page
    .getByRole('dialog')
    .locator('.sheet-scroll')
    .evaluate((element) => {
      element.scrollTo(0, element.scrollHeight);
    });
  const interviewer = page.getByRole('checkbox', { name: '体验负责人' });
  await interviewer.focus();
  await interviewer.press('Space');
  await expect(interviewer).toBeChecked();
  const saveSchedule = page.getByRole('button', { name: '保存排期' });
  await saveSchedule.focus();
  await saveSchedule.press('Enter');
  await expect(
    page.getByText('排期已保存，候选人与面试官的系统内时间冲突已检查。邀请尚未发送。'),
  ).toBeVisible();
  await page.getByRole('button', { name: '关闭详情' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('link', { name: '面试', exact: true }).click();
  await expect(page.getByText('邀请尚未发送', { exact: true })).toBeVisible();
  await expect(page.locator('table').getByText('虚构林一', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
