import {
  BriefcaseBusiness,
  CalendarDays,
  ChevronRight,
  CircleCheck,
  LogOut,
  Plus,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ErrorNotice, Loading } from '@/components/feedback';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ApiError, api, type Me } from '@/lib/api';
import { ApplicationDetail, Candidates } from '@/pages/intake';
import { CreateJob, JobDetail } from '@/pages/job-detail';
import { Jobs, Today } from '@/pages/workspace';

const routeFromHash = () =>
  ['jobs', 'candidates'].includes(window.location.hash.slice(1))
    ? window.location.hash.slice(1)
    : 'today';

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [local, setLocal] = useState(false);
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
      const config = await api<{ local_environment: boolean }>('auth/csrf/');
      setLocal(config.local_environment);
      try {
        setMe(await api<Me>('me/'));
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 403)) throw e;
        setMe(null);
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
    window.addEventListener('hashchange', nav);
    return () => window.removeEventListener('hashchange', nav);
  }, [boot]);
  if (!ready) return <Loading />;
  if (!me)
    return (
      <Login
        local={local}
        error={error}
        retry={boot}
        onLogin={async () => {
          setMe(await api<Me>('me/'));
          setError('');
        }}
      />
    );
  const roleNames: Record<string, string> = {
    hr: 'HR',
    manager: '用人负责人',
    supervisor: '招聘主管',
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
            {route === 'today' ? '今天' : route === 'jobs' ? '职位' : '候选人'}
          </span>
          <div className="account">
            {local && <Badge variant="outline">本地体验</Badge>}
            <span>
              {me.name}
              <small>{me.roles.map((r) => roleNames[r] || r).join(' / ') || '暂无招聘职责'}</small>
            </span>
            <Button
              variant="ghost"
              size="icon"
              disabled={leaving}
              aria-label="退出登录"
              onClick={async () => {
                setLeaving(true);
                try {
                  await api('auth/logout/', {});
                  setMe(null);
                  setJobId(null);
                  setApplicationId(null);
                  window.location.hash = 'today';
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
                {route === 'today' ? '从今天的重要事项开始' : route === 'jobs' ? '职位' : '候选人'}
              </h1>
              <p>
                {route === 'today'
                  ? '先处理需要你决定的事，再跟进等待中的工作。'
                  : route === 'jobs'
                    ? '查看你负责、协作或获授权的职位，明确每一次招聘的要求。'
                    : '先核对材料与身份，再处理每一次独立应聘。'}
              </p>
            </div>
            {me.departments.length > 0 && route !== 'candidates' && (
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

function Login({
  local,
  error,
  retry,
  onLogin,
}: {
  local: boolean;
  error: string;
  retry: () => void;
  onLogin: () => Promise<void>;
}) {
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="login-page">
      <section className="login-story">
        <div className="brand">
          <BriefcaseBusiness />
          <strong>知遇 AI</strong>
        </div>
        <p className="eyebrow">让合适的人，遇见合适的机会</p>
        <h1>
          招人有方向，
          <br />
          协作有回应。
        </h1>
        <p>
          从明确招人要求开始，
          <br />
          让每一次判断都有依据，每一步都有接手的人。
        </p>
        <div className="login-points">
          <span>
            <CircleCheck />
            明确要求
          </span>
          <span>
            <CircleCheck />
            共同确认
          </span>
          <span>
            <CircleCheck />
            保留依据
          </span>
        </div>
      </section>
      <section className="login-card">
        <Badge variant="secondary">招聘工作台</Badge>
        <h2>欢迎回来</h2>
        <p>使用团队分配的账号登录。</p>
        {local && <p className="local-note">本地开发体验环境 · 请勿录入真实候选人资料</p>}
        {error ? <ErrorNotice message={error} retry={retry} /> : null}
        {failure && <ErrorNotice message={failure} />}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            setBusy(true);
            setFailure('');
            try {
              await api('auth/csrf/');
              await api('auth/login/', {
                username: data.get('username'),
                password: data.get('password'),
              });
              await onLogin();
            } catch (e) {
              setFailure((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="username">账号</FieldLabel>
              <Input
                id="username"
                name="username"
                autoComplete="username"
                required
                maxLength={150}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="password">密码</FieldLabel>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                maxLength={1024}
              />
            </Field>
            <Button type="submit" disabled={busy || !!error}>
              {busy ? '正在登录…' : '进入工作台'}
            </Button>
          </FieldGroup>
        </form>
        <p className="login-help">没有账号或无法登录？请联系团队管理员分配权限。</p>
      </section>
    </div>
  );
}
