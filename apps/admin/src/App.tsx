import {
  Bot,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  ChevronDown,
  CircleHelp,
  Flag,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  Sparkles,
  UserRoundCheck,
  UsersRound,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ErrorNotice, Loading } from '@/components/feedback';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { ApiError, api, type DashboardData, type Me } from '@/lib/api';
import { ApplicationDetail, type CandidateLibraryActions, Candidates } from '@/pages/intake';
import { Interviews } from '@/pages/interviews';
import { CreateJob, JobDetail } from '@/pages/job-detail';
import { Jobs, Today } from '@/pages/workspace';

type Route =
  | 'today'
  | 'jobs'
  | 'candidates'
  | 'interviews'
  | 'ai-screening'
  | 'question-bank'
  | 'employer-brand'
  | 'employees'
  | 'employees-unlinked';

const knownRoutes = new Set<Route>([
  'today',
  'jobs',
  'candidates',
  'interviews',
  'ai-screening',
  'question-bank',
  'employer-brand',
  'employees',
  'employees-unlinked',
]);

const routeFromHash = (): Route => {
  const route = window.location.hash.slice(1) as Route;
  return knownRoutes.has(route) ? route : 'today';
};

function formatDate(date: Date) {
  return date
    .toLocaleDateString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    .replaceAll('/', '-');
}

function currentWeekPeriod() {
  const current = new Date();
  const monday = new Date(current);
  monday.setDate(current.getDate() - ((current.getDay() + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { start: formatDate(monday), end: formatDate(sunday) };
}

function exportDashboard(data: DashboardData) {
  const metricRows = [
    ['人才库总数', data.metrics.talent_pool_total, '全部候选人记录'],
    ['当日新增简历', data.metrics.resumes_today, '按北京时间自然日'],
    ['今日面试安排', data.metrics.interviews_today, data.period.today],
    ['本周 offer 发放', data.metrics.offers_this_week ?? '尚未接通', 'Offer 流程尚未接通'],
    ['待入职人数', data.metrics.pending_onboarding ?? '尚未接通', '入职交接尚未接通'],
    ['已入职', data.metrics.hired_total ?? '尚未接通', '入职记录尚未接通'],
  ];
  const rows: (string | number)[][] = [
    ['招聘总览导出', `${data.period.week_start} ~ ${data.period.week_end}`, '当前授权范围'],
    ['统计项', '值', '统计口径'],
    ...metricRows,
    [],
    ['近 14 天新增简历', '数量', '日期'],
    ...data.daily_resumes.map((item) => ['新增简历', item.count, item.date]),
    [],
    ['候选人状态', '数量', '阶段代码'],
    ...data.candidate_stages.map((item) => [item.label, item.count, item.stage]),
  ];
  const csv = rows
    .map((row) => row.map((cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(','))
    .join('\r\n');
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `招聘总览-${data.period.today}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [homeUrl, setHomeUrl] = useState('');
  const [route, setRoute] = useState(routeFromHash);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [applicationId, setApplicationId] = useState<number | null>(null);
  const [jobId, setJobId] = useState<number | null>(null);
  const [jobTab, setJobTab] = useState('requirements');
  const [creating, setCreating] = useState(false);
  const [revision, setRevision] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const candidateLibraryRef = useRef<CandidateLibraryActions>(null);

  function openJob(id: number, tab = 'requirements') {
    setJobTab(tab);
    setJobId(id);
  }

  const boot = useCallback(async () => {
    setReady(false);
    setError('');
    try {
      const config = await api<{ local_environment: boolean; home_url: string }>('auth/csrf/');
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
    const nav = () => {
      setRoute(routeFromHash());
      setMobileNavOpen(false);
    };
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

  const period = dashboardData
    ? { start: dashboardData.period.week_start, end: dashboardData.period.week_end }
    : currentWeekPeriod();
  const routeContent: Record<Route, { title: string; description: string }> = {
    today: {
      title: '招聘总览',
      description: `统计口径：本周为自然周（周一 00:00 至周日 23:59），当前周 ${period.start} ~ ${period.end}`,
    },
    jobs: {
      title: '职位管理',
      description: '查看你负责、协作或获授权的职位，明确每一次招聘的要求。',
    },
    candidates: { title: '候选人库', description: '候选人全生命周期与状态流转' },
    interviews: { title: '面试管理', description: '查看已保存的系统内排期与当前参与状态。' },
    'ai-screening': {
      title: 'AI 初面',
      description: '该入口已按原型保留，正式 AI 初面能力尚未接通。',
    },
    'question-bank': {
      title: '面试题库',
      description: '该入口已按原型保留，题库与面试指南将在后续切片接入。',
    },
    'employer-brand': {
      title: '企业背书',
      description: '该参考功能尚未进入正式范围，不会显示占位数据。',
    },
    employees: {
      title: '全部在职',
      description: '完整在职人员管理尚未接通，招聘系统不会冒充人事系统。',
    },
    'employees-unlinked': {
      title: '未关联企业',
      description: '完整在职人员管理尚未接通，当前没有可核验的关联统计。',
    },
  };

  const current = routeContent[route];
  const roleNames: Record<string, string> = {
    hr: 'HR',
    manager: '用人负责人',
    supervisor: '招聘主管',
    interviewer: '面试官',
    resume_download: '简历原件下载',
  };
  const roleLabel = me.roles.map((role) => roleNames[role] || role).join(' / ');
  const profileLabel = `${roleLabel} · ${
    me.auth_source === 'feishu' ? '飞书个人设置' : '个人设置 · 本地体验'
  }`;

  const logout = async () => {
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
  };

  return (
    <div className="workspace">
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>

      <aside className="desktop-sidebar" aria-label="侧边栏">
        <SidebarPanel
          me={me}
          route={route}
          profileLabel={profileLabel}
          leaving={leaving}
          openProfile={() => setProfileOpen(true)}
          logout={logout}
        />
      </aside>

      <header className="mobile-header">
        <Button
          className="mobile-menu-button"
          variant="ghost"
          size="icon"
          aria-label="菜单"
          onClick={() => setMobileNavOpen(true)}
        >
          <Menu />
        </Button>
        <strong>{current.title}</strong>
        <button
          type="button"
          className="mobile-avatar-button"
          aria-label="打开飞书个人设置"
          onClick={() => setProfileOpen(true)}
        >
          <UserAvatar me={me} />
        </button>
      </header>

      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" showCloseButton={false} className="mobile-nav-sheet">
          <SheetHeader className="sr-only">
            <SheetTitle>招聘工作台菜单</SheetTitle>
            <SheetDescription>选择要进入的招聘功能</SheetDescription>
          </SheetHeader>
          <SidebarPanel
            me={me}
            route={route}
            profileLabel={profileLabel}
            leaving={leaving}
            openProfile={() => setProfileOpen(true)}
            logout={logout}
          />
        </SheetContent>
      </Sheet>

      <div className="workspace-body">
        <main className="workspace-main" id="main-content" tabIndex={-1}>
          <div className="page-heading">
            <div>
              <h1>{current.title}</h1>
              <p>{current.description}</p>
            </div>
            <div className="page-actions">
              {route === 'today' && (
                <>
                  <Button variant="outline" onClick={() => setRevision((value) => value + 1)}>
                    刷新
                  </Button>
                  <Button
                    disabled={!dashboardData}
                    title="导出本页全部招聘总览数据"
                    onClick={() => dashboardData && exportDashboard(dashboardData)}
                  >
                    导出全部数据
                  </Button>
                </>
              )}
              {route === 'jobs' && me.departments.length > 0 && (
                <Button onClick={() => setCreating(true)}>
                  <Plus data-icon="inline-start" />
                  新建职位
                </Button>
              )}
              {route === 'candidates' && (
                <>
                  <Button
                    variant="outline"
                    onClick={() => candidateLibraryRef.current?.exportModule()}
                  >
                    导出本模块
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => candidateLibraryRef.current?.showMailboxSyncStatus()}
                  >
                    从邮箱同步
                  </Button>
                  <Button onClick={() => candidateLibraryRef.current?.openCreateCandidate()}>
                    新增候选人
                  </Button>
                </>
              )}
            </div>
          </div>
          {error && <ErrorNotice message={error} retry={() => setError('')} />}
          {route === 'today' ? (
            <Today revision={revision} onLoaded={setDashboardData} />
          ) : route === 'candidates' ? (
            <Candidates
              ref={candidateLibraryRef}
              revision={revision}
              changed={() => setRevision((value) => value + 1)}
              openApplication={setApplicationId}
            />
          ) : route === 'interviews' ? (
            <Interviews revision={revision} />
          ) : route === 'jobs' ? (
            <Jobs
              revision={revision}
              openJob={openJob}
              canCreate={me.departments.length > 0}
              create={() => setCreating(true)}
            />
          ) : (
            <UnavailablePage route={route} />
          )}
        </main>
      </div>

      <Sheet open={profileOpen} onOpenChange={setProfileOpen}>
        <SheetContent className="profile-sheet">
          <SheetHeader>
            <SheetTitle>飞书个人信息</SheetTitle>
            <SheetDescription>
              头像和姓名来自当前登录身份，招聘权限由组织授权决定。
            </SheetDescription>
          </SheetHeader>
          <div className="profile-sheet-body">
            <UserAvatar me={me} large />
            <div>
              <h2>{me.name}</h2>
              <p>{me.organization}</p>
            </div>
            <div className="profile-role-list">
              {me.roles.map((role) => (
                <Badge key={role} variant="secondary">
                  {roleNames[role] || role}
                </Badge>
              ))}
            </div>
            <p className="profile-source-note">
              {me.auth_source === 'feishu'
                ? '当前已通过飞书身份进入工作台；如需更换头像或姓名，请在飞书中修改后重新登录。'
                : '当前使用本地体验身份，未连接飞书头像。'}
            </p>
          </div>
        </SheetContent>
      </Sheet>

      {applicationId !== null && (
        <ApplicationDetail
          key={applicationId}
          id={applicationId}
          close={() => setApplicationId(null)}
          changed={() => setRevision((value) => value + 1)}
        />
      )}
      {creating && (
        <CreateJob
          me={me}
          close={() => setCreating(false)}
          created={(job) => {
            setCreating(false);
            openJob(job.id);
            setRevision((value) => value + 1);
          }}
        />
      )}
      {jobId !== null && (
        <JobDetail
          id={jobId}
          initialTab={jobTab}
          close={() => setJobId(null)}
          changed={() => setRevision((value) => value + 1)}
        />
      )}
    </div>
  );
}

function UserAvatar({ me, large = false }: { me: Me; large?: boolean }) {
  return (
    <Avatar size={large ? 'lg' : 'default'}>
      {me.avatar_url && (
        <AvatarImage src={me.avatar_url} alt={`${me.name}的头像`} referrerPolicy="no-referrer" />
      )}
      <AvatarFallback>{Array.from(me.name.trim())[0] || '我'}</AvatarFallback>
    </Avatar>
  );
}

function SidebarPanel({
  me,
  route,
  profileLabel,
  leaving,
  openProfile,
  logout,
}: {
  me: Me;
  route: Route;
  profileLabel: string;
  leaving: boolean;
  openProfile: () => void;
  logout: () => Promise<void>;
}) {
  const [employeesOpen, setEmployeesOpen] = useState(false);
  const navigation = [
    { route: 'today' as const, label: '招聘总览', legacyLabel: '今天', icon: LayoutDashboard },
    { route: 'candidates' as const, label: '候选人库', legacyLabel: '候选人', icon: UsersRound },
    { route: 'jobs' as const, label: '职位管理', legacyLabel: '职位', icon: BriefcaseBusiness },
    { route: 'interviews' as const, label: '面试管理', legacyLabel: '面试', icon: CalendarDays },
    { route: 'ai-screening' as const, label: 'AI 初面', icon: Sparkles },
    { route: 'question-bank' as const, label: '面试题库', icon: CircleHelp },
    { route: 'employer-brand' as const, label: '企业背书', icon: Building2 },
  ];
  return (
    <div className="sidebar-panel">
      <button type="button" className="account-profile" onClick={openProfile}>
        <UserAvatar me={me} large />
        <span className="account-details">
          <span className="account-name" title={me.name}>
            {me.name}
          </span>
          <small>{profileLabel}</small>
        </span>
        <ChevronDown className="account-chevron" aria-hidden="true" />
      </button>
      <p className="nav-label">招聘工作台</p>
      <nav aria-label="主导航">
        {navigation.map((item) => (
          <a
            key={item.route}
            href={`#${item.route}`}
            aria-label={item.legacyLabel || item.label}
            aria-current={route === item.route ? 'page' : undefined}
          >
            <item.icon aria-hidden="true" />
            <span>{item.label}</span>
          </a>
        ))}
        <button
          type="button"
          className={`employee-nav-trigger${route === 'employees' || route === 'employees-unlinked' ? ' is-active' : ''}`}
          aria-expanded={employeesOpen}
          onClick={() => setEmployeesOpen((value) => !value)}
        >
          <UserRoundCheck aria-hidden="true" />
          <span>在职人员管理</span>
          <ChevronDown className={employeesOpen ? 'is-open' : ''} aria-hidden="true" />
        </button>
        {employeesOpen && (
          <div className="employee-subnav">
            <a href="#employees" aria-current={route === 'employees' ? 'page' : undefined}>
              <span>全部在职</span>
              <small>—</small>
            </a>
            <a
              href="#employees-unlinked"
              aria-current={route === 'employees-unlinked' ? 'page' : undefined}
            >
              <span>未关联企业</span>
              <small>—</small>
            </a>
          </div>
        )}
      </nav>
      <div className="sidebar-bottom">
        <div className="connection-status" role="status">
          <span aria-hidden="true" />
          已同步
        </div>
        <Button
          className="sidebar-logout"
          variant="ghost"
          disabled={leaving}
          aria-label="退出登录"
          onClick={() => void logout()}
        >
          <LogOut data-icon="inline-start" />
          退出登录
        </Button>
      </div>
    </div>
  );
}

function UnavailablePage({
  route,
}: {
  route: Exclude<Route, 'today' | 'jobs' | 'candidates' | 'interviews'>;
}) {
  const messages: Record<typeof route, { icon: typeof Bot; title: string; body: string }> = {
    'ai-screening': {
      icon: Bot,
      title: 'AI 初面尚未接通',
      body: '当前不会生成虚假的 AI 评分或面试结果。正式接入模型、证据与人工复核流程后，这里再开放。',
    },
    'question-bank': {
      icon: CircleHelp,
      title: '面试题库尚未接通',
      body: '当前已保留原型入口，但还没有可核验的题库记录。',
    },
    'employer-brand': {
      icon: Building2,
      title: '企业背书尚未进入正式范围',
      body: '这里不会展示演示素材或伪造企业信息。',
    },
    employees: {
      icon: UserRoundCheck,
      title: '在职人员管理尚未接通',
      body: '招聘系统只保留未来入职交接的衔接位置，不复制一套虚假的人事花名册。',
    },
    'employees-unlinked': {
      icon: Flag,
      title: '暂无可核验的未关联记录',
      body: '完整入职与企业关联数据接通后，这里再显示真实数量。',
    },
  };
  const item = messages[route];
  return (
    <section className="dashboard-card unavailable-page">
      <item.icon aria-hidden="true" />
      <h2>{item.title}</h2>
      <p>{item.body}</p>
      <Button variant="outline" onClick={() => window.location.assign('#today')}>
        返回招聘总览
      </Button>
    </section>
  );
}
