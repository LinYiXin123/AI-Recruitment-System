import { expect, test } from '@playwright/test';

test('两个画像表格显示各自经办 HR，头像和姓名打开对应飞书私聊，未绑定时仅显示', async ({
  page,
  context,
}) => {
  const currentUser = {
    name: '虚构当前登录者',
    avatar_url: 'https://avatars.example.test/current-user.svg',
  };
  const owners = [
    {
      name: '林虚构经办',
      avatar: 'https://avatars.example.test/owner.svg',
      chat: 'https://applink.feishu.cn/client/chat/open?openId=ou_fictional_lin',
    },
    {
      name: '周虚构失效',
      avatar: 'https://avatars.example.test/broken.svg',
      chat: 'https://applink.feishu.cn/client/chat/open?openId=ou_fictional_zhou',
    },
    { name: '陈虚构无图', avatar: '', chat: '' },
  ];
  const jobs = owners.map((owner, index) => ({
    id: 99401 + index,
    title: `虚构头像验收职位${index + 1}`,
    department_name: '虚构测试部门',
    location: '深圳',
    status: 'open',
    owner_name: owner.name,
    owner_avatar_url: owner.avatar,
    owner_chat_url: owner.chat,
    active_profile: 99411 + index,
    active_profile_number: 1,
    latest_profile: { id: 99411 + index },
    permissions: { edit: true, confirm: false },
  }));
  const applications = jobs.map((job, index) => ({
    id: 99421 + index,
    candidate: 99431 + index,
    name: `虚构头像验收人选${index + 1}`,
    candidate_deleted_at: null,
    candidate_updated_at: '2026-10-09T04:00:00Z',
    can_restore_candidate: false,
    job: job.id,
    job_title: job.title,
    job_status: 'open',
    attempt_no: 1,
    stage: 'pending_review',
    closed_at: null,
    owner_name: job.owner_name,
    owner_avatar_url: job.owner_avatar_url,
    owner_chat_url: job.owner_chat_url,
  }));
  const unexpected: string[] = [];
  const avatarRequests = new Set<string>();
  const chatRequests: string[] = [];
  const expectedChats: string[] = [];
  // 新标签页的首个请求由 context 拦截，避免访问飞书、唤起客户端或发送任何消息。
  await context.route('https://applink.feishu.cn/**', (route) => {
    chatRequests.push(route.request().url());
    expect(route.request().method()).toBe('GET');
    return route.fulfill({ contentType: 'text/html', body: '<title>虚构私聊入口验收</title>' });
  });
  // 所有身份、业务接口和头像均为虚构响应，不访问真实候选人或外部图片。
  await page.route('https://avatars.example.test/**', (route) => {
    avatarRequests.add(route.request().url());
    if (route.request().url().endsWith('/broken.svg')) return route.fulfill({ status: 404 });
    return route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#2563eb"/></svg>',
    });
  });
  await page.route('**/api/v1/**', (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET') {
      if (path === '/api/v1/auth/csrf/')
        return route.fulfill({ json: { csrfToken: 'fictional-avatar-csrf', home_url: '/' } });
      if (path === '/api/v1/me/')
        return route.fulfill({
          json: {
            ...currentUser,
            auth_source: 'feishu',
            organization: '虚构验收组织',
            roles: ['hr'],
            departments: [],
          },
        });
      if (path === '/api/v1/jobs/')
        return route.fulfill({
          json: { count: jobs.length, next: null, previous: null, results: jobs },
        });
      if (path === '/api/v1/applications/')
        return route.fulfill({
          json: { count: applications.length, next: null, previous: null, results: applications },
        });
      if (path === '/api/v1/applications/filter-options/')
        return route.fulfill({
          json: { jobs: jobs.map((job) => ({ job_id: job.id, job__title: job.title })) },
        });
    }
    unexpected.push(`${request.method()} ${path}`);
    return route.fulfill({ status: 500, json: { errors: { detail: '未预期的验收请求' } } });
  });

  await page.goto('/#talent-profiles');
  const originalUrl = page.url();
  for (const tab of ['招人要求', '简历对照', '招人要求']) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    await expect(page.getByRole('columnheader', { name: '经办 HR', exact: true })).toBeVisible();
    for (const [index, owner] of owners.entries()) {
      const rowName = tab === '简历对照' ? applications[index].name : jobs[index].title;
      const row = page.getByRole('row').filter({ hasText: rowName });
      const ownerCell = row.getByRole('gridcell').filter({
        has: page.getByText(owner.name, { exact: true }),
      });
      await expect(ownerCell.getByText(owner.name, { exact: true })).toBeVisible();
      await expect(ownerCell).not.toContainText(currentUser.name);
      const avatar = ownerCell.locator('[data-slot="avatar-image"]');
      const fallback = ownerCell.locator('[data-slot="avatar-fallback"]');
      if (index === 0) {
        await expect(avatar).toBeVisible();
        await expect(avatar).toHaveAttribute('src', owner.avatar);
        await expect
          .poll(() => avatar.evaluate((element) => (element as HTMLImageElement).naturalWidth))
          .toBeGreaterThan(0);
        await expect(fallback).toBeHidden();
      } else {
        await expect(fallback).toBeVisible();
        await expect(fallback).toHaveText(owner.name[0]);
        await expect(avatar).toBeHidden();
      }
      if (owner.chat) {
        const chat = ownerCell.getByRole('link', {
          name: `在飞书中与${owner.name}私聊`,
          exact: true,
        });
        await expect(chat).toHaveAttribute('href', owner.chat);
        await expect(chat).toHaveAttribute('target', '_blank');
        await expect(chat).toHaveAttribute('rel', 'noopener noreferrer');
        for (const target of [
          chat.locator('[data-slot="avatar"]'),
          chat.getByText(owner.name, { exact: true }),
        ]) {
          expectedChats.push(owner.chat);
          const popupPromise = page.waitForEvent('popup');
          await target.click();
          const popup = await popupPromise;
          try {
            await popup.waitForLoadState('domcontentloaded');
            await expect(popup).toHaveURL(owner.chat);
            await expect(page).toHaveURL(originalUrl);
            await expect(page.getByRole('tab', { name: tab, exact: true })).toHaveAttribute(
              'aria-selected',
              'true',
            );
          } finally {
            await popup.close();
          }
        }
      } else {
        await expect(ownerCell.getByRole('link')).toHaveCount(0);
        await expect(
          ownerCell.getByTitle('尚未绑定飞书，暂不能发起私聊', { exact: true }),
        ).toBeVisible();
      }
    }
  }
  expect(avatarRequests.has(owners[0].avatar)).toBe(true);
  expect(avatarRequests.has(owners[1].avatar)).toBe(true);
  expect(chatRequests).toEqual(expectedChats);
  expect(unexpected).toEqual([]);
});
