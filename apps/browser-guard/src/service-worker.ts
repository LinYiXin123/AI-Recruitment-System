import { addEvent, CONFIG_STORAGE_KEY, isProtectableUrl, readGuardConfig, writeGuardConfig, type GuardEvent } from './lib/guard-config';

async function shouldGuard(url?: string): Promise<boolean> {
  if (!isProtectableUrl(url)) return false;
  const config = await readGuardConfig();
  return Boolean(config.sites[new URL(url).origin]?.enabled);
}

async function injectGuard(tabId: number, url?: string): Promise<void> {
  if (!(await shouldGuard(url))) return;

  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['guard.js'] });
  } catch {
    // 受浏览器保护的页面和刚关闭的标签页无法注入；无需把它当作用户错误。
  }
}

async function injectGuardForTab(tabId: number): Promise<void> {
  try {
    const tab = await chrome.tabs.get(tabId);
    await injectGuard(tabId, tab.url);
  } catch {
    // 标签页在请求完成前关闭时无需提示用户。
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  void injectGuard(tabId, tab.url);
});

chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  if (!message || typeof message !== 'object') return;
  const payload = message as { enabled?: boolean; event?: GuardEvent; origin?: string; tabId?: number; type?: string };

  if (payload.type === 'guard-event' && payload.event) {
    void (async () => {
      const config = await readGuardConfig();
      await writeGuardConfig(addEvent(config, payload.event!));
    })();
  }

  if (payload.type === 'guard-config-changed') {
    const tabId = payload.tabId ?? sender.tab?.id;
    if (tabId === undefined) return;
    if (payload.enabled) void injectGuardForTab(tabId);
    else void chrome.tabs.sendMessage(tabId, { type: 'guard-disable', origin: payload.origin }).catch(() => undefined);
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes[CONFIG_STORAGE_KEY]) return;
  const previousSites = (changes[CONFIG_STORAGE_KEY].oldValue as { sites?: Record<string, { enabled?: boolean }> } | undefined)?.sites ?? {};
  const nextSites = (changes[CONFIG_STORAGE_KEY].newValue as { sites?: Record<string, { enabled?: boolean }> } | undefined)?.sites ?? {};
  const removedOrigins = Object.keys(previousSites).filter((origin) => !nextSites[origin]?.enabled);
  if (!removedOrigins.length) return;

  void chrome.tabs.query({}).then((tabs) => {
    for (const tab of tabs) {
      if (tab.id === undefined || !isProtectableUrl(tab.url)) continue;
      const origin = new URL(tab.url).origin;
      if (removedOrigins.includes(origin)) {
        void chrome.tabs.sendMessage(tab.id, { type: 'guard-disable', origin }).catch(() => undefined);
      }
    }
  });
});
