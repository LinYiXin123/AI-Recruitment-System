import {
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
  UserRoundSearch,
  UsersRound,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ErrorNotice, Loading } from '@/components/feedback';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { ApiError, api, type DashboardData, type Me } from '@/lib/api';
import { AiScreeningPage } from '@/pages/ai-screening';
import { EmployerBrandPage } from '@/pages/employer-brand';
import { ApplicationDetail, type CandidateLibraryActions, Candidates } from '@/pages/intake';
import { type InterviewActions, Interviews } from '@/pages/interviews';
import { CreateJob, JobDetail } from '@/pages/job-detail';
import { QuestionBank } from '@/pages/question-bank';
import { Jobs, type JobsActions, Today } from '@/pages/workspace';

type Route =
  | 'today'
  | 'jobs'
  | 'candidates'
  | 'talent-profiles'
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
  'talent-profiles',
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
  const interviewRef = useRef<InterviewActions>(null);
  const jobsRef = useRef<JobsActions>(null);

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
    'talent-profiles': { title: '人才画像', description: '人才画像功能待接入。' },
    interviews: { title: '面试管理', description: '面试安排与记录，一人可多轮' },
    'ai-screening': {
      title: 'AI 初面',
      description: '选择候选人 + 粘贴简历 + 选择目标职位，由大模型给出匹配初判',
    },
    'question-bank': {
      title: '面试题库',
      description: '按职位与考察维度分类管理',
    },
    'employer-brand': {
      title: '企业背书',
      description: '按企业维护招聘背书内容，并为 AI 初面提供企业背景。',
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
        <main
          className={`workspace-main${route === 'ai-screening' ? ' ai-screening-main' : ''}`}
          id="main-content"
          tabIndex={-1}
        >
          {route !== 'employer-brand' && route !== 'question-bank' && (
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
                {route === 'jobs' && (
                  <>
                    <Button variant="outline" onClick={() => jobsRef.current?.exportModule()}>
                      导出本模块
                    </Button>
                    {me.departments.length > 0 && (
                      <Button onClick={() => setCreating(true)}>
                        <Plus data-icon="inline-start" />
                        新建职位
                      </Button>
                    )}
                  </>
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
                {route === 'interviews' && (
                  <>
                    <Button variant="outline" onClick={() => interviewRef.current?.exportModule()}>
                      导出本模块
                    </Button>
                    <Button
                      title="前往候选人详情安排真实面试记录"
                      onClick={() => {
                        window.location.hash = 'candidates';
                      }}
                    >
                      新增面试记录
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}
          {error && <ErrorNotice message={error} retry={() => setError('')} />}
          {route === 'today' ? (
            <Today revision={revision} onLoaded={setDashboardData} />
          ) : route === 'ai-screening' ? (
            <AiScreeningPage />
          ) : route === 'candidates' ? (
            <Candidates
              ref={candidateLibraryRef}
              revision={revision}
              changed={() => setRevision((value) => value + 1)}
              openApplication={setApplicationId}
            />
          ) : route === 'interviews' ? (
            <Interviews ref={interviewRef} revision={revision} />
          ) : route === 'jobs' ? (
            <Jobs
              ref={jobsRef}
              revision={revision}
              openJob={openJob}
              canCreate={me.departments.length > 0}
              departments={me.departments}
            />
          ) : route === 'employer-brand' ? (
            <EmployerBrandPage />
          ) : route === 'question-bank' ? (
            <QuestionBank />
          ) : (
            <UnavailablePage route={route} />
          )}
        </main>
      </div>

      <Sheet open={profileOpen} onOpenChange={setProfileOpen}>
        <SheetContent side="top" className="profile-settings-dialog">
          <SheetHeader className="profile-settings-header">
            <SheetTitle>个人设置</SheetTitle>
            <SheetDescription className="sr-only">
              查看个人资料和邮箱自动同步设置。
            </SheetDescription>
          </SheetHeader>
          <div className="profile-settings-body">
            <section className="profile-settings-section" aria-labelledby="mailbox-sync-title">
              <Separator />
              <h2 id="mailbox-sync-title">邮箱自动同步</h2>
              <Alert className="profile-sync-notice">
                <AlertDescription>
                  开启后，系统会定时读取此邮箱中的附件简历并写入你名下的候选人库。目前邮箱服务尚未接通，因此不会保存邮箱地址或授权码；请继续使用“新增候选人”导入简历。
                </AlertDescription>
              </Alert>
              <FieldGroup>
                <FieldSet>
                  <FieldLegend variant="label">启用邮箱自动同步</FieldLegend>
                  <Field orientation="horizontal" data-disabled>
                    <Checkbox
                      id="mailbox-sync-enabled"
                      aria-label="启用邮箱自动同步"
                      checked={false}
                      disabled
                    />
                    <FieldContent>
                      <FieldLabel htmlFor="mailbox-sync-enabled">尚未接通</FieldLabel>
                      <FieldDescription>完成服务端邮箱集成后才能开启。</FieldDescription>
                    </FieldContent>
                  </Field>
                </FieldSet>
                <Field data-disabled>
                  <FieldLabel htmlFor="mailbox-address">邮箱地址</FieldLabel>
                  <Input
                    id="mailbox-address"
                    className="h-11"
                    type="email"
                    placeholder="接通后可配置完整邮箱地址"
                    disabled
                  />
                  <FieldDescription>完整邮箱地址，例如 6xxxxxxxx@qq.com</FieldDescription>
                </Field>
                <Field data-disabled>
                  <FieldLabel htmlFor="mailbox-password">邮箱授权码</FieldLabel>
                  <Input
                    id="mailbox-password"
                    className="h-11"
                    type="password"
                    placeholder="服务尚未接通，暂不能保存授权码"
                    disabled
                  />
                  <FieldDescription>
                    授权码应仅由服务端安全保存和使用，不会回显或写入日志。
                  </FieldDescription>
                </Field>
              </FieldGroup>
              <details className="profile-settings-advanced">
                <summary>进阶设置（IMAP 服务器 / 端口 / 收件目录）</summary>
                <p>邮箱集成接通后，可在这里配置服务端连接参数和收件目录。</p>
              </details>
              <div className="profile-sync-actions">
                <Button disabled>保存配置</Button>
                <Button variant="outline" disabled>
                  立即同步
                </Button>
                <p>同步状态：邮箱服务尚未接通。</p>
              </div>
            </section>

            <section className="profile-settings-section" aria-labelledby="profile-info-title">
              <Separator />
              <h2 id="profile-info-title">个人资料</h2>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="profile-name">昵称</FieldLabel>
                  <Input id="profile-name" className="h-11" value={me.name} readOnly />
                  <FieldDescription>
                    {me.auth_source === 'feishu'
                      ? '昵称和头像来自飞书身份；在飞书中修改后重新登录即可同步。'
                      : '当前使用本地体验身份，昵称和头像由体验账号提供。'}
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel>头像</FieldLabel>
                  <div className="profile-settings-avatar-row">
                    <UserAvatar me={me} large />
                    <FieldContent>
                      <FieldTitle>{me.organization}</FieldTitle>
                      <FieldDescription>头像由当前登录身份提供。</FieldDescription>
                    </FieldContent>
                  </div>
                </Field>
                <Field data-disabled>
                  <FieldLabel htmlFor="ai-model-name">AI 初面使用的模型名</FieldLabel>
                  <Input
                    id="ai-model-name"
                    className="h-11"
                    placeholder="留空即可，由系统自动选用"
                    disabled
                  />
                  <FieldDescription>AI 初面服务接通后可由管理员统一配置。</FieldDescription>
                </Field>
              </FieldGroup>
              <div className="profile-role-list">
                {me.roles.map((role) => (
                  <Badge key={role} variant="secondary">
                    {roleNames[role] || role}
                  </Badge>
                ))}
              </div>
            </section>
          </div>
          <SheetFooter className="profile-settings-footer">
            <Button variant="outline" onClick={() => setProfileOpen(false)}>
              关闭
            </Button>
          </SheetFooter>
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
    { route: 'talent-profiles' as const, label: '人才画像', icon: UserRoundSearch },
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
  route: Exclude<
    Route,
    | 'today'
    | 'jobs'
    | 'candidates'
    | 'interviews'
    | 'ai-screening'
    | 'employer-brand'
    | 'question-bank'
  >;
}) {
  const messages: Record<typeof route, { icon: typeof Building2; title: string; body: string }> = {
    'talent-profiles': {
      icon: UserRoundSearch,
      title: '人才画像尚未接入',
      body: '目前可在候选人库查看已有档案；这里暂不生成或展示画像。',
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
