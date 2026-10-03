import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { test } from '@playwright/test';
import { ApiError, api } from '../src/lib/api';

// 沿用 Playwright runner 验证共享请求层；此文件不发真实网络请求，Cookie 均为虚构值。
let cookie = '';
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
test.beforeEach(() => {
  cookie = '';
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      get cookie() {
        return cookie;
      },
    },
  });
});
test.afterEach(() => {
  mock.restoreAll();
  if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
  else Reflect.deleteProperty(globalThis, 'document');
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('登录和其他标签页轮换 Cookie 后，写请求使用发送时的凭证', async () => {
  cookie = 'recruitment_csrf=before-login';
  const sent: string[] = [];
  mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    if (input === '/api/v1/auth/csrf/') return json({ csrfToken: 'old-masked-response' });
    sent.push(new Headers(init?.headers).get('X-CSRFToken') || '');
    if (input === '/api/v1/auth/login/') {
      cookie = 'recruitment_csrf=after-login';
      return json({ csrfToken: 'new-masked-response' });
    }
    return json({ ok: true });
  });
  await api('auth/csrf/');
  await api('auth/login/', { username: 'fictional-user', password: 'test-only' });
  await api('jobs/profile-ai/', { jd: '虚构岗位要求' });
  cookie = 'recruitment_csrf_shadow=ignored; session=unrelated; recruitment_csrf=other-tab';
  await api('jobs/profile-ai/', { jd: '虚构岗位要求' });
  await api('auth/logout/', {});
  assert.deepEqual(sent, ['before-login', 'after-login', 'other-tab', 'other-tab']);
});

test('缺 Cookie 时取得凭证，无 body 的 DELETE 仍带 CSRF 且正确处理 204', async () => {
  const calls: { input: unknown; init?: RequestInit }[] = [];
  mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, init });
    if (input === '/api/v1/auth/csrf/') {
      cookie = 'recruitment_csrf=current-cookie';
      return json({ csrfToken: 'masked-response' });
    }
    return new Response(null, { status: 204 });
  });
  await api('ai-screenings/0/', undefined, undefined, 'DELETE');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init?.method, 'GET');
  assert.equal(calls[1].init?.method, 'DELETE');
  assert.equal(calls[1].init?.body, undefined);
  assert.equal(calls[1].init?.credentials, 'same-origin');
  assert.equal(new Headers(calls[1].init?.headers).get('X-CSRFToken'), 'current-cookie');
  assert.equal(new Headers(calls[1].init?.headers).get('Content-Type'), null);
});

test('GET 不取凭证，JSON PATCH 与 FormData POST 保留请求格式和 signal', async () => {
  const calls: RequestInit[] = [];
  mock.method(globalThis, 'fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(init || {});
    return json({ ok: true });
  });
  await api('me/');
  cookie = 'recruitment_csrf=current-cookie';
  const controller = new AbortController();
  await api('question-templates/1/', { title: '虚构问题' }, controller.signal, 'PATCH');
  const form = new FormData();
  form.set('file', new Blob(['虚构资料']), 'test.txt');
  await api('imports/1/upload/', form, controller.signal);
  assert.equal(calls.length, 3);
  assert.equal(new Headers(calls[0].headers).get('X-CSRFToken'), null);
  assert.equal(calls[1].method, 'PATCH');
  assert.equal(calls[1].body, JSON.stringify({ title: '虚构问题' }));
  assert.equal(new Headers(calls[1].headers).get('Content-Type'), 'application/json');
  assert.equal(calls[2].method, 'POST');
  assert.equal(calls[2].body, form);
  assert.equal(new Headers(calls[2].headers).get('Content-Type'), null);
  assert.equal(new Headers(calls[2].headers).get('X-CSRFToken'), 'current-cookie');
  assert.equal(calls[1].signal, controller.signal);
  assert.equal(calls[2].signal, controller.signal);
});

for (const [status, detail, csrf] of [
  [403, "CSRF Failed: CSRF token from the 'X-Csrftoken' HTTP header incorrect.", true],
  [403, '页面安全凭证已过期，请刷新后重试。', true],
  [403, '当前无权修改此职位。', false],
  [409, '记录已经更新。', false],
  [500, '服务暂时不可用。', false],
] as const) {
  test(`${status} ${detail} 不会自动重放业务请求`, async () => {
    cookie = 'recruitment_csrf=current-cookie';
    const fetch = mock.method(globalThis, 'fetch', async () =>
      json({ errors: { detail } }, status),
    );
    await assert.rejects(api('jobs/profile-ai/', { jd: '虚构岗位要求' }), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, status);
      assert.equal(error.message.includes('本次操作未执行'), csrf);
      if (!csrf) assert.equal(error.message, detail);
      return true;
    });
    assert.equal(fetch.mock.callCount(), 1);
  });
}

test('网络断开不会自动重放；请求输入保持不变', async () => {
  cookie = 'recruitment_csrf=current-cookie';
  const fetch = mock.method(globalThis, 'fetch', async () => {
    throw new TypeError('offline');
  });
  const input = Object.freeze({ jd: '虚构岗位要求', request_key: 'same-key' });
  await assert.rejects(api('jobs/profile-ai/', input), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 0);
    return true;
  });
  assert.equal(fetch.mock.callCount(), 1);
  assert.deepEqual(input, { jd: '虚构岗位要求', request_key: 'same-key' });
});

test('取凭证失败时不发送业务请求', async () => {
  const fetch = mock.method(globalThis, 'fetch', async () =>
    json({ errors: '服务暂时不可用' }, 503),
  );
  await assert.rejects(api('jobs/profile-ai/', {}), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 503);
    return true;
  });
  assert.equal(fetch.mock.callCount(), 1);
});

test('取消请求时保留 AbortError；取凭证结束后也不再发送业务请求', async () => {
  const controller = new AbortController();
  const fetch = mock.method(
    globalThis,
    'fetch',
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(init?.signal, controller.signal);
      controller.abort();
      return json({ csrfToken: 'test-token' });
    },
  );
  await assert.rejects(api('jobs/profile-ai/', {}, controller.signal), { name: 'AbortError' });
  assert.equal(fetch.mock.callCount(), 1);
  await assert.rejects(api('me/', undefined, controller.signal), { name: 'AbortError' });
  assert.equal(fetch.mock.callCount(), 1);
});

test('成功响应解析中取消请求不伪装成网络或业务失败', async () => {
  const response = json({ ok: true });
  mock.method(response, 'json', async () => {
    throw new DOMException('Aborted', 'AbortError');
  });
  const fetch = mock.method(globalThis, 'fetch', async () => response);
  await assert.rejects(api('me/'), { name: 'AbortError' });
  assert.equal(fetch.mock.callCount(), 1);
});
