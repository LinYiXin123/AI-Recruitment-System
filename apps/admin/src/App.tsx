import {
  BriefcaseBusiness,
  CalendarDays,
  ChevronRight,
  LogOut,
  Plus,
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

const routeFromHash = () =>
  ['jobs', 'candidates', 'interviews'].includes(window.location.hash.slice(1))
    ? window.location.hash.slice(1)
    : 'today';

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
      <main>
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
  return (
    <div className="workspace">
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <aside className="sidebar">
        <div className="brand">
          <BriefcaseBusiness aria-hidden="true" />
          <div>
            <strong>知遇 AI</strong>
            <span>招聘工作台</span>
          </div>
        </div>
        <div className="organization">{me.organization}</div>
        <p className="nav-label">招聘工作</p>
        <nav aria-label="主导航">
          <a href="#today" aria-current={route === 'today' ? 'page' : undefined}>
            <CalendarDays aria-hidden="true" />
            <span>今天</span>
          </a>
          <a href="#jobs" aria-current={route === 'jobs' ? 'page' : undefined}>
            <BriefcaseBusiness aria-hidden="true" />
            <span>职位</span>
          </a>
          {me.roles.includes('hr') && (
            <a href="#candidates" aria-current={route === 'candidates' ? 'page' : undefined}>
              <Users aria-hidden="true" />
              <span>候选人</span>
            </a>
          )}
          <a href="#interviews" aria-current={route === 'interviews' ? 'page' : undefined}>
            <CalendarDays aria-hidden="true" />
            <span>面试</span>
          </a>
        </nav>
        <div className="sidebar-bottom">
          <ShieldCheck aria-hidden="true" />
          <span>只呈现你获授权的工作</span>
        </div>
      </aside>
      <div className="workspace-body">
        <header className="topbar">
          <span>
            招聘工作台 <ChevronRight aria-hidden="true" />{' '}
            {route === 'today'
              ? '今天'
              : route === 'jobs'
                ? '职位'
                : route === 'candidates'
                  ? '候选人'
                  : '面试'}
          </span>
          <div className="account">
            {local && me.auth_source !== 'feishu' && <Badge variant="outline">本地体验</Badge>}
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
                <small>
                  {me.roles.map((r) => roleNames[r] || r).join(' / ') || '暂无招聘职责'}
                </small>
              </span>
            </div>
            <Button
              variant="ghost"
              size="icon"
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
              <LogOut />
            </Button>
          </div>
        </header>
        <main id="main-content" tabIndex={-1}>
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {new Date().toLocaleDateString('zh-CN', {
                  timeZone: 'Asia/Shanghai',
                  month: 'long',
                  day: 'numeric',
                  weekday: 'long',
                })}
              </p>
              <h1>
                {route === 'today'
                  ? '从今天的重要事项开始'
                  : route === 'jobs'
                    ? '职位'
                    : route === 'candidates'
                      ? '候选人'
                      : '面试'}
              </h1>
              <p>
                {route === 'today'
                  ? '先处理需要你决定的事，再跟进等待中的工作。'
                  : route === 'jobs'
                    ? '查看你负责、协作或获授权的职位，明确每一次招聘的要求。'
                    : route === 'candidates'
                      ? '先核对材料与身份，再处理每一次独立应聘。'
                      : '查看已保存的系统内排期与当前参与状态。'}
              </p>
            </div>
            {me.departments.length > 0 && !['candidates', 'interviews'].includes(route) && (
              <Button onClick={() => setCreating(true)}>
                <Plus data-icon="inline-start" />
                新建职位
              </Button>
            )}
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
