import {
  BriefcaseBusiness,
  CalendarDays,
  LogOut,
  Plus,
  RefreshCw,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ErrorNotice, Loading } from '@/components/feedback';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ApiError, api, type Me } from '@/lib/api';
import { ApplicationDetail, Candidates } from '@/pages/intake';
import { Interviews } from '@/pages/interviews';
import { CreateJob, JobDetail } from '@/pages/job-detail';
import { Jobs, Today } from '@/pages/workspace';

type Route = 'today' | 'jobs' | 'candidates' | 'interviews';

const routeFromHash = (): Route => {
  const route = window.location.hash.slice(1);
  return route === 'jobs' || route === 'candidates' || route === 'interviews' ? route : 'today';
};

function currentWeekLabel() {
  const current = new Date();
  const monday = new Date(current);
  monday.setDate(current.getDate() - ((current.getDay() + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const format = (date: Date) =>
    date.toLocaleDateString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  return `本周 ${format(monday)} 至 ${format(sunday)}`;
}

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [local, setLocal] = useState(false);
  const [homeUrl, setHomeUrl] = useState('');
  const [route, setRoute] = useState(routeFromHash);
  const [applicationId, setApplicationId] = useState<number | null>(null);
  const [jobId, setJobId] = useState<number | null>(null);
  const [jobTab, setJobTab] = useState('requirements');
  function openJob(id: number, tab = 'requirements') {
    setJobTab(tab);
    setJobId(id);
  }
  const [creating, setCreating] = useState(false);
  const [revision, setRevision] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const boot = useCallback(async () => {
    setReady(false);
    setError('');
    try {
      const config = await api<{ local_environment: boolean; home_url: string }>('auth/csrf/');
      setLocal(config.local_environment);
      setHomeUrl(config.home_url);
      try {
        setMe(await api<Me>('me/'));
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 403)) throw e;
        setMe(null);
        window.location.replace(config.home_url);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReady(true);
    }
  }, []);
  useEffect(() => {
    void boot();
    const nav = () => setRoute(routeFromHash());
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) void boot();
    };
    window.addEventListener('hashchange', nav);
    window.addEventListener('pageshow', restore);
    return () => {
      window.removeEventListener('hashchange', nav);
      window.removeEventListener('pageshow', restore);
    };
  }, [boot]);
  if (!ready || (!me && !error)) return <Loading />;
  if (!me)
    return (
      <main className="standalone-main">
        <ErrorNotice message={error} retry={boot} />
        {homeUrl && (
          <a className="text-primary underline underline-offset-4" href={homeUrl}>
            返回首页
          </a>
        )}
      </main>
    );
  const roleNames: Record<string, string> = {
    hr: 'HR',
    manager: '用人负责人',
    supervisor: '招聘主管',
    interviewer: '面试官',
    resume_download: '简历原件下载',
  };
  const routeContent = {
    today: {
      title: '招聘总览',
      description: `${currentWeekLabel()} · 先处理需要你决定的事项，再跟进等待中的工作。`,
    },
    jobs: {
      title: '职位管理',
      description: '查看你负责、协作或获授权的职位，明确每一次招聘的要求。',
    },
    candidates: {
      title: '候选人库',
      description: '先核对材料与身份，再处理每一次独立应聘。',
    },
    interviews: {
      title: '面试管理',
      description: '查看已保存的系统内排期与当前参与状态。',
    },
  }[route];
  return (
    <div className="workspace">
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <aside className="sidebar">
        <div className="account-profile">
          <Avatar size="lg">
            {me.avatar_url && (
              <AvatarImage
                src={me.avatar_url}
                alt={`${me.name}的头像`}
                referrerPolicy="no-referrer"
              />
            )}
            <AvatarFallback>{Array.from(me.name.trim())[0] || '我'}</AvatarFallback>
          </Avatar>
          <span className="account-details">
            <span className="account-name" title={me.name}>
              {me.name}
            </span>
            <small>{me.roles.map((r) => roleNames[r] || r).join(' / ') || '暂无招聘职责'}</small>
          </span>
        </div>
        <div className="organization" title={me.organization}>
          {me.organization}
          {local && me.auth_source !== 'feishu' && <Badge variant="outline">本地体验</Badge>}
        </div>
        <p className="nav-label">知遇 AI · 招聘工作台</p>
        <nav aria-label="主导航">
          <a href="#today" aria-label="今天" aria-current={route === 'today' ? 'page' : undefined}>
            <CalendarDays aria-hidden="true" />
            <span>招聘总览</span>
          </a>
          <a href="#jobs" aria-label="职位" aria-current={route === 'jobs' ? 'page' : undefined}>
            <BriefcaseBusiness aria-hidden="true" />
            <span>职位管理</span>
          </a>
          {me.roles.includes('hr') && (
            <a
              href="#candidates"
              aria-label="候选人"
              aria-current={route === 'candidates' ? 'page' : undefined}
            >
              <Users aria-hidden="true" />
              <span>候选人库</span>
            </a>
          )}
          <a
            href="#interviews"
            aria-label="面试"
            aria-current={route === 'interviews' ? 'page' : undefined}
          >
            <CalendarDays aria-hidden="true" />
            <span>面试管理</span>
          </a>
        </nav>
        <div className="sidebar-bottom">
          <div className="connection-status">
            <ShieldCheck aria-hidden="true" />
            <span>已连接 · 仅呈现授权工作</span>
          </div>
          <Button
            className="sidebar-logout"
            variant="ghost"
            disabled={leaving}
            aria-label="退出登录"
            onClick={async () => {
              setLeaving(true);
              try {
                const result = await api<{ redirect_url: string }>('auth/logout/', {});
                setMe(null);
                setError('');
                window.location.replace(result.redirect_url);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setLeaving(false);
              }
            }}
          >
            <LogOut data-icon="inline-start" />
            退出登录
          </Button>
        </div>
      </aside>
      <div className="workspace-body">
        <main className="workspace-main" id="main-content" tabIndex={-1}>
          <div className="page-heading">
            <div>
              <h1>{routeContent.title}</h1>
              <p>{routeContent.description}</p>
            </div>
            <div className="page-actions">
              {route === 'today' && (
                <Button variant="outline" onClick={() => setRevision((r) => r + 1)}>
                  <RefreshCw data-icon="inline-start" />
                  刷新
                </Button>
              )}
              {me.departments.length > 0 && !['candidates', 'interviews'].includes(route) && (
                <Button onClick={() => setCreating(true)}>
                  <Plus data-icon="inline-start" />
                  新建职位
                </Button>
              )}
            </div>
          </div>
          {error && <ErrorNotice message={error} retry={() => setError('')} />}
          {route === 'today' ? (
            <Today
              openApplication={setApplicationId}
              revision={revision}
              openJob={openJob}
              canCreate={me.departments.length > 0}
              create={() => setCreating(true)}
            />
          ) : route === 'candidates' ? (
            <Candidates
              revision={revision}
              changed={() => setRevision((r) => r + 1)}
              openApplication={setApplicationId}
            />
          ) : route === 'interviews' ? (
            <Interviews revision={revision} />
          ) : (
            <Jobs
              revision={revision}
              openJob={openJob}
              canCreate={me.departments.length > 0}
              create={() => setCreating(true)}
            />
          )}
        </main>
      </div>
      {applicationId !== null && (
        <ApplicationDetail
          key={applicationId}
          id={applicationId}
          close={() => setApplicationId(null)}
          changed={() => setRevision((r) => r + 1)}
        />
      )}
      {creating && (
        <CreateJob
          me={me}
          close={() => setCreating(false)}
          created={(job) => {
            setCreating(false);
            openJob(job.id);
            setRevision((r) => r + 1);
          }}
        />
      )}
      {jobId !== null && (
        <JobDetail
          id={jobId}
          initialTab={jobTab}
          close={() => setJobId(null)}
          changed={() => setRevision((r) => r + 1)}
        />
      )}
    </div>
  );
}
