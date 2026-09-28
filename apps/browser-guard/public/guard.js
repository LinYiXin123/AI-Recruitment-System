(() => {
  const guardKey = '__siteSafetyNoticeInstalled__';
  const configKey = 'browserGuardConfig';
  const minRepeatInterval = 20_000;

  if (window.top !== window || window[guardKey]) return;
  window[guardKey] = true;

  const currentOrigin = window.location.origin;
  let lastNoticeAt = 0;
  let wasLikelyDocked = false;
  let noticeHost;
  let started = false;

  const isLikelyDockedDevtools = () => {
    const widthGap = Math.max(0, window.outerWidth - window.innerWidth);
    const heightGap = Math.max(0, window.outerHeight - window.innerHeight);

    // 浏览器工具栏、系统缩放和侧边栏都会影响尺寸；这是提示阈值，不能用于安全判定。
    return widthGap >= 180 || heightGap >= 320;
  };

  const report = () => {
    chrome.runtime.sendMessage({
      type: 'guard-event',
      event: {
        origin: currentOrigin,
        occurredAt: new Date().toISOString(),
        kind: 'possible-docked-devtools',
      },
    });
  };

  const dismissNotice = () => {
    noticeHost?.remove();
    noticeHost = undefined;
  };

  const showNotice = () => {
    dismissNotice();
    noticeHost = document.createElement('div');
    noticeHost.setAttribute('aria-live', 'polite');
    noticeHost.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:min(390px,calc(100vw - 32px));';
    const shadow = noticeHost.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `
      <style>
        * { box-sizing: border-box; }
        .notice { color: #1e293b; background: #ffffff; border: 1px solid #b9c8e2; border-radius: 12px; box-shadow: 0 14px 36px rgba(15, 23, 42, .18); padding: 16px; font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
        strong { display: block; margin-bottom: 6px; color: #173d80; font-size: 15px; }
        p { margin: 0; color: #475569; }
        button { margin-top: 12px; border: 0; border-radius: 7px; padding: 7px 10px; color: #173d80; background: #eaf1fd; font: inherit; cursor: pointer; }
        button:focus-visible { outline: 3px solid #2456b8; outline-offset: 3px; }
      </style>
      <aside class="notice" role="status">
        <strong>页面安全提示</strong>
        <p>检测到窗口尺寸异常，可能是开发者工具停靠打开，也可能由浏览器界面或缩放造成。此提示不会阻止访问或关闭工具。</p>
        <button type="button">知道了</button>
      </aside>`;
    shadow.querySelector('button')?.addEventListener('click', dismissNotice);
    document.documentElement.append(noticeHost);
  };

  const check = () => {
    const likelyDocked = isLikelyDockedDevtools();
    const now = Date.now();

    if (likelyDocked && (!wasLikelyDocked || now - lastNoticeAt >= minRepeatInterval)) {
      lastNoticeAt = now;
      showNotice();
      report();
    }
    wasLikelyDocked = likelyDocked;
  };

  const stop = () => {
    if (!started) return;
    started = false;
    window.removeEventListener('resize', check);
    window.visualViewport?.removeEventListener('resize', check);
    dismissNotice();
  };

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'guard-disable' && message.origin === currentOrigin) stop();
  });

  chrome.storage.local.get(configKey).then((stored) => {
    const config = stored[configKey];
    if (!config?.sites?.[currentOrigin]?.enabled) return;

    started = true;
    window.addEventListener('resize', check, { passive: true });
    window.visualViewport?.addEventListener('resize', check, { passive: true });
    check();
  });
})();
