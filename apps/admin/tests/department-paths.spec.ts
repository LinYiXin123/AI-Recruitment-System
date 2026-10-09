import { expect, test } from '@playwright/test';
import type { Job } from '../src/lib/api';

test('同名部门按完整组织路径搜索建岗与筛选，提交稳定部门编号并保留短名展示', async ({ page }) => {
  const departments = [
    {
      id: 99801,
      name: '研发部',
      path: '虚构甲公司 / 华南事业部 / 研发部',
      approvers: [{ id: 99811, name: '虚构甲负责人' }],
      collaborators: [],
    },
    {
      id: 99802,
      name: '研发部',
      path: '虚构乙公司 / 华北事业部 / 研发部',
      approvers: [{ id: 99812, name: '虚构乙负责人' }],
      collaborators: [],
    },
  ];
  const jobs: Job[] = departments.map((department, index) => ({
    id: 99821 + index,
    title: `虚构路径验收职位${index + 1}`,
    department: department.id,
    department_name: department.name,
    department_path: department.path,
    company_name: '',
    job_level: '',
    salary_range: '',
    base_salary: '',
    performance_salary: '',
    commission_salary: '',
    total_monthly_salary: '',
    planned_publish_date: null,
    location: '深圳',
    headcount: 1,
    owner_name: '虚构验收 HR',
    owner_avatar_url: '',
    owner_chat_url: '',
    approver_name: department.approvers[0].name,
    status: 'draft',
    jd: '',
    version: 1,
    updated_at: '2026-10-10T00:00:00Z',
    active_profile: null,
    active_profile_number: null,
    latest_profile: null,
    permissions: { edit: true, confirm: false },
  }));
  const queriedDepartments: string[] = [];
  const creations: Record<string, unknown>[] = [];
  const unexpected: string[] = [];
  // 全部接口仅使用虚构组织与职位，不读取企业目录，也不写入真实招聘数据。
  await page.route('**/api/v1/**', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (request.method() === 'GET') {
      if (path === '/api/v1/auth/csrf/')
        return route.fulfill({ json: { csrfToken: 'fictional-department-csrf', home_url: '/' } });
      if (path === '/api/v1/me/')
        return route.fulfill({
          json: {
            name: '虚构验收 HR',
            avatar_url: '',
            auth_source: 'local',
            organization: '虚构验收集团',
            roles: ['hr'],
            departments,
          },
        });
      if (path === '/api/v1/jobs/') {
        const department = url.searchParams.get('department') || '';
        queriedDepartments.push(department);
        const results = jobs.filter((job) => !department || String(job.department) === department);
        return route.fulfill({
          json: { count: results.length, next: null, previous: null, results },
        });
      }
      const job = jobs.find((item) => path === `/api/v1/jobs/${item.id}/`);
      if (job) return route.fulfill({ json: job });
    }
    if (request.method() === 'POST' && path === '/api/v1/jobs/') {
      const payload = request.postDataJSON();
      creations.push(payload);
      expect(payload).toMatchObject({
        department: departments[1].id,
        approver: departments[1].approvers[0].id,
      });
      const created = { ...jobs[1], id: 99823, title: payload.title };
      jobs.push(created);
      return route.fulfill({ status: 201, json: created });
    }
    unexpected.push(`${request.method()} ${path}`);
    return route.fulfill({ status: 500, json: { errors: { detail: '未预期的验收请求' } } });
  });

  await page.goto('/#jobs');
  for (const [index, job] of jobs.entries()) {
    const row = page.getByRole('row').filter({ hasText: job.title });
    await expect(row.getByText('研发部', { exact: true })).toHaveAttribute(
      'title',
      departments[index].path,
    );
  }
  const filter = page.getByLabel('按部门筛选职位', { exact: true });
  for (const [index, department] of departments.entries()) {
    await filter.click();
    await page
      .getByPlaceholder('搜索公司或部门', { exact: true })
      .fill(department.path.split(' / ')[0]);
    await expect(
      page.getByRole('option').filter({ hasText: departments[1 - index].path }),
    ).toHaveCount(0);
    await page.getByRole('option').filter({ hasText: department.path }).click();
    await expect(filter).toContainText(department.path);
    await expect(page.getByRole('row').filter({ hasText: jobs[index].title })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: jobs[1 - index].title })).toHaveCount(0);
    expect(queriedDepartments).toContain(String(department.id));
  }

  await page.getByRole('button', { name: '新建职位', exact: true }).click();
  const create = page.getByRole('dialog', { name: '新建职位', exact: true });
  const departmentSelect = create.getByLabel('所属部门', { exact: true });
  await expect(departmentSelect).toContainText(departments[0].path);
  await departmentSelect.click();
  await page.getByPlaceholder('搜索选项', { exact: true }).fill('华北事业部');
  await expect(page.getByRole('option').filter({ hasText: departments[0].path })).toHaveCount(0);
  await page.getByRole('option').filter({ hasText: departments[1].path }).click();
  await expect(departmentSelect).toContainText(departments[1].path);
  await create.getByRole('textbox', { name: '职位名称', exact: true }).fill('虚构跨公司部门新职位');
  await create.getByLabel('工作地点', { exact: true }).fill('北京');
  await create.getByLabel('用人负责人（用于澄清）', { exact: true }).click();
  await expect(page.getByRole('option').filter({ hasText: '虚构甲负责人' })).toHaveCount(0);
  await page.getByRole('option').filter({ hasText: '虚构乙负责人' }).click();
  await create.getByRole('button', { name: '保存', exact: true }).click();

  const detail = page.getByRole('dialog', { name: '虚构跨公司部门新职位', exact: true });
  await expect(detail.locator('[data-slot="sheet-description"]')).toContainText(
    departments[1].path,
  );
  await detail.getByRole('tab', { name: '职位信息', exact: true }).click();
  await expect(detail.getByText(departments[1].path, { exact: true })).toBeVisible();
  expect(creations).toHaveLength(1);
  await detail.getByRole('button', { name: '关闭详情', exact: true }).click();
  const createdRow = page.getByRole('row').filter({ hasText: '虚构跨公司部门新职位' });
  await expect(createdRow.getByText('研发部', { exact: true })).toHaveAttribute(
    'title',
    departments[1].path,
  );
  expect(unexpected).toEqual([]);
});
