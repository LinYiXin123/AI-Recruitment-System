import '@douyinfe/semi-ui/react19-adapter';
import { HistoryIcon, ShieldCheckIcon, Trash2Icon } from 'lucide-react';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { originPermission, readGuardConfig, writeGuardConfig, type GuardConfig } from '@/lib/guard-config';
import './index.css';

function displayTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function EmptyState({ title, description }: { description: string; title: string }) {
  return <div className="empty-state"><strong>{title}</strong><p>{description}</p></div>;
}

function Options() {
  const [config, setConfig] = useState<GuardConfig | null>(null);
  const [notice, setNotice] = useState('');

  const load = async () => setConfig(await readGuardConfig());
  useEffect(() => { void load(); }, []);

  const removeSite = async (origin: string) => {
    const next = await readGuardConfig();
    delete next.sites[origin];
    await writeGuardConfig(next);
    await chrome.permissions.remove({ origins: [originPermission(origin)] });
    await load();
    setNotice(`已移除 ${origin}。`);
  };

  const clearEvents = async () => {
    const next = await readGuardConfig();
    next.events = [];
    await writeGuardConfig(next);
    await load();
    setNotice('已清空本扩展保存的提示记录。');
  };

  const sites = Object.keys(config?.sites ?? {});
  return (
    <main className="options-shell">
      <header className="options-header">
        <span className="icon-surface" aria-hidden="true"><ShieldCheckIcon /></span>
        <div><h1>页面安全提示</h1><p>仅管理你已经明确授权的网站</p></div>
      </header>

      <Alert>
        <ShieldCheckIcon />
        <AlertTitle>使用范围</AlertTitle>
        <AlertDescription>此扩展只记录网站来源和发生时间，不记录页面地址、页面内容或输入信息。它提供的是可绕过的提示，不是反调试安全措施。</AlertDescription>
      </Alert>

      {notice ? <p className="status-message" role="status">{notice}</p> : null}

      <section className="options-section" aria-labelledby="sites-title">
        <div className="section-heading"><div><h2 id="sites-title">已启用的网站</h2><p>关闭后会同时移除该网站的扩展访问权限。</p></div></div>
        {config === null ? <p>正在读取设置…</p> : sites.length ? (
          <ul className="record-list">
            {sites.map((origin) => <li key={origin}><span>{origin}</span><Button variant="outline" size="sm" onClick={() => void removeSite(origin)}><Trash2Icon data-icon="inline-start" />移除</Button></li>)}
          </ul>
        ) : <EmptyState title="还没有启用的网站" description="打开目标网站后，点击扩展图标即可添加。" />}
      </section>

      <section className="options-section" aria-labelledby="events-title">
        <div className="section-heading"><div><h2 id="events-title">提示记录</h2><p>最多保留最近 50 条，仅作为排查线索。</p></div><Button variant="outline" size="sm" disabled={!config?.events.length} onClick={() => void clearEvents()}>清空记录</Button></div>
        {config === null ? <p>正在读取记录…</p> : config.events.length ? (
          <ul className="event-list">
            {config.events.map((event, index) => <li key={`${event.occurredAt}-${index}`}><HistoryIcon aria-hidden="true" /><div><strong>可能检测到停靠式开发者工具</strong><p>{event.origin} · {displayTime(event.occurredAt)}</p></div></li>)}
          </ul>
        ) : <EmptyState title="暂无提示记录" description="发生窗口尺寸异常时会记录在这里。" />}
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><Options /></StrictMode>);
