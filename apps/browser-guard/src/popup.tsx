import '@douyinfe/semi-ui/react19-adapter';
import Switch from '@douyinfe/semi-ui/lib/es/switch';
import { ExternalLinkIcon, InfoIcon, ShieldCheckIcon } from 'lucide-react';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { isProtectableUrl, originPermission, readGuardConfig, writeGuardConfig } from '@/lib/guard-config';
import './index.css';

type ActiveSite = { origin: string; tabId: number } | null;

function Popup() {
  const [site, setSite] = useState<ActiveSite>(null);
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState('正在读取当前页面…');
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    void (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !isProtectableUrl(tab.url) || tab.id === undefined) {
        setMessage('此页面不支持启用。请在普通的 HTTP 或 HTTPS 网站上操作。');
        return;
      }

      const origin = new URL(tab.url).origin;
      const config = await readGuardConfig();
      setSite({ origin, tabId: tab.id });
      setEnabled(Boolean(config.sites[origin]?.enabled));
      setMessage('');
    })();
  }, []);

  const updateEnabled = async (nextEnabled: boolean) => {
    if (!site) return;
    setUpdating(true);
    setMessage('');

    try {
      if (nextEnabled) {
        const granted = await chrome.permissions.request({ origins: [originPermission(site.origin)] });
        if (!granted) {
          setMessage('未获得该网站的访问权限，设置未改变。');
          return;
        }
      }

      const config = await readGuardConfig();
      if (nextEnabled) config.sites[site.origin] = { enabled: true };
      else delete config.sites[site.origin];
      await writeGuardConfig(config);
      setEnabled(nextEnabled);
      await chrome.runtime.sendMessage({ type: 'guard-config-changed', tabId: site.tabId, origin: site.origin, enabled: nextEnabled });
      setMessage(nextEnabled ? '已启用：当前页面已开始提示。' : '已关闭此网站的提示。');
    } catch {
      setMessage('设置保存失败，请重试。');
    } finally {
      setUpdating(false);
    }
  };

  return (
    <main className="popup-shell">
      <header className="flex items-start gap-3">
        <span className="icon-surface" aria-hidden="true"><ShieldCheckIcon /></span>
        <div className="min-w-0">
          <h1>页面安全提示</h1>
          <p>针对指定网站的轻量提醒</p>
        </div>
      </header>

      <Alert>
        <InfoIcon />
        <AlertTitle>提示不是安全边界</AlertTitle>
        <AlertDescription>它不会关闭开发者工具、阻止访问或保护浏览器中的源码；关键规则与密钥应放在服务端。</AlertDescription>
      </Alert>

      {site ? (
        <section className="setting-card" aria-labelledby="site-title">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <h2 id="site-title">保护此网站</h2>
              <p className="truncate" title={site.origin}>{site.origin}</p>
            </div>
            <Switch
              checked={enabled}
              disabled={updating}
              aria-label={`切换 ${site.origin} 的页面安全提示`}
              onChange={(checked) => void updateEnabled(checked)}
            />
          </div>
          <p className="setting-help">窗口尺寸出现异常时，页面右下角会显示非阻断提示。尺寸变化也可能由缩放或浏览器界面造成。</p>
        </section>
      ) : (
        <section className="setting-card" aria-live="polite"><p>{message}</p></section>
      )}

      {message && site ? <p className="status-message" role="status">{message}</p> : null}

      <Button variant="outline" className="w-full" onClick={() => chrome.runtime.openOptionsPage()}>
        <ExternalLinkIcon data-icon="inline-start" />
        管理网站与提示记录
      </Button>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><Popup /></StrictMode>);
