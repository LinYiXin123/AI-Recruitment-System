import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('候选人表格窄屏只保留内部横向滚动且末列详情可操作', async ({ page }) => {
  await login(page);
  // 仅用虚构接口数据验证布局，不创建或读取真实候选人档案。
  const candidate = {
    id: 99001,
    display_name: '虚构滚动验收人',
    phone: '',
    email: '',
    contact_note: '布局验收材料',
    current_city: '泉州',
    education_level: '本科',
    work_years: '4 年',
    expected_salary: '12-15K · 13薪',
    source: '内推',
    applications: [],
    resume_documents: [],
  };
  await page.route(/\/api\/v1\/candidates\/(?:\?.*)?$/, (route) =>
    route.fulfill({ json: { count: 1, next: null, previous: null, results: [candidate] } }),
  );
  await page.route(`**/api/v1/candidates/${candidate.id}/`, (route) =>
    route.fulfill({ json: candidate }),
  );
  await page.getByRole('link', { name: '候选人', exact: true }).click();
  const container = page.locator('.candidate-library-panel .table-container');
  await expect(
    container.getByRole('button', { name: candidate.display_name, exact: true }),
  ).toBeVisible();
  for (const width of [1013, 390]) {
    await page.setViewportSize({ width, height: 984 });
    await expect
      .poll(() =>
        container.evaluate((element) =>
          [element, ...element.querySelectorAll<HTMLElement>('*')]
            .filter(
              (item) =>
                ['auto', 'scroll'].includes(getComputedStyle(item).overflowX) &&
                item.scrollWidth > item.clientWidth + 1,
            )
            .map((item) => item.className),
        ),
      )
      .toEqual(['semi-table-body']);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBeTruthy();
    await container.locator('.semi-table-body').evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
    });
    await expect(
      container.getByRole('columnheader', { name: '操作', exact: true }),
    ).toBeInViewport();
    const detail = container.getByRole('button', { name: '详情', exact: true });
    await expect(detail).toBeInViewport();
    await page.screenshot({ path: `../../.local/candidate-table-scroll/候选人表格-${width}.png` });
    await detail.click();
    await expect(page).toHaveURL(new RegExp(`#candidate/${candidate.id}$`));
    await expect(page.getByRole('region', { name: '候选人详情', exact: true })).toContainText(
      candidate.display_name,
    );
    await page.getByRole('button', { name: '返回候选人库', exact: true }).click();
  }
  await page.setViewportSize({ width: 1440, height: 984 });
  await expect
    .poll(() => container.evaluate((element) => element.scrollWidth <= element.clientWidth + 1))
    .toBeTruthy();
});
