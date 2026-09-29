import Table from '@douyinfe/semi-ui/lib/es/table';
import {
  ArrowRight,
  BriefcaseBusiness,
  CalendarCheck2,
  CalendarDays,
  Check,
  Flag,
  Plus,
  Plus as PlusIcon,
  UserRound,
  UsersRound,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Blank, ErrorNotice, Loading, Pager } from '@/components/feedback';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { api, type DashboardData, type Job, jobStatus, type Page, profileStatus } from '@/lib/api';

type WorkspaceProps = {
  revision: number;
  openJob: (id: number, tab?: string) => void;
  canCreate: boolean;
  create: () => void;
  openApplication?: (id: number) => void;
};
type TodayProps = {
  revision: number;
  onLoaded: (data: DashboardData | null) => void;
};

export function Today({ revision, onLoaded }: TodayProps) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError('');
    onLoaded(null);
    api<DashboardData>('dashboard/', undefined, controller.signal)
      .then((result) => {
        setData(result);
        onLoaded(result);
      })
      .catch((error) => {
        if (error.name !== 'AbortError') setError(error.message);
      });
    return () => controller.abort();
  }, [revision, reload, onLoaded]);

  if (error) return <ErrorNotice message={error} retry={() => setReload((value) => value + 1)} />;
  if (!data) return <Loading />;

  return (
    <div className="recruitment-dashboard" id="dashboard-body">
      <section className="dashboard-kpi-grid" aria-label="招聘概览">
        <KpiCard
          href="#candidates"
          label="人才库总数"
          value={data.metrics.talent_pool_total}
          note="全部候选人记录"
          icon={UsersRound}
        />
        <KpiCard
          href="#candidates"
          label="当日新增简历"
          value={data.metrics.resumes_today}
          note="按北京时间自然日"
          icon={PlusIcon}
        />
        <KpiCard
          href="#interviews"
          label="今日面试安排"
          value={data.metrics.interviews_today}
          note={data.metrics.interviews_today === 0 ? '今日暂无安排' : '点击查看今日安排'}
          icon={CalendarCheck2}
        />
        <KpiCard
          label="本周 offer 发放"
          value={data.metrics.offers_this_week}
          note="Offer 流程尚未接通"
          icon={Check}
          tone="warning"
        />
        <KpiCard
          label="待入职人数"
          value={data.metrics.pending_onboarding}
          note="入职交接尚未接通"
          icon={UserRound}
        />
        <KpiCard
          label="已入职"
          value={data.metrics.hired_total}
          note="入职记录尚未接通"
          icon={Flag}
          tone="success"
        />
      </section>

      <div className="dashboard-trend-grid">
        <ChartCard title="近 14 天每日新增简历" note="按北京时间自然日 · 点击柱子查看当日新增">
          <MiniBarChart points={data.daily_resumes} href="#candidates" />
        </ChartCard>
        <ChartCard title="近 8 周 offer 发放" note="自然周 · 周一至周日 · 尚未接通">
          <UnavailableBars labels={eightWeekLabels(data.period.today)} tone="warning" />
        </ChartCard>
        <ChartCard title="近 8 周入职" note="按入职时间 · 尚未接通">
          <UnavailableBars labels={eightWeekLabels(data.period.today)} tone="success" />
        </ChartCard>
      </div>

      <section className="dashboard-card onboarding-card">
        <div className="dashboard-card-head">
          <h2>入职分析</h2>
          <span>按入职时间 · 自然周/自然月</span>
        </div>
        <div className="onboarding-analysis">
          <AnalysisCell value="—" label="offer→入职 转化率（近 8 周）" />
          <AnalysisCell value="—" label="本月入职" />
          <AnalysisCell value="—" label="offer→入职 周转中位数（近 8 周）" />
        </div>
      </section>

      <div className="dashboard-bottom-grid">
        <section className="dashboard-card">
          <div className="dashboard-card-head">
            <h2>候选人状态分布</h2>
            <span>点击某一行查看该状态候选人</span>
          </div>
          <div className="stage-list">
            {data.candidate_stages.every((item) => item.count === 0) ? (
              <DashboardBlank
                title="还没有候选人数据"
                action="去「候选人库」录入第一位候选人"
                href="#candidates"
                icon={UsersRound}
              />
            ) : (
              data.candidate_stages.map((item) => (
                <a href="#candidates" className="stage-row" key={item.stage}>
                  <span>{item.label}</span>
                  <strong>{item.count}</strong>
                  <ArrowRight aria-hidden="true" />
                </a>
              ))
            )}
          </div>
        </section>
        <section className="dashboard-card">
          <div className="dashboard-card-head">
            <h2>今日面试安排</h2>
            <span>{data.period.today}</span>
          </div>
          {data.today_interviews.length === 0 ? (
            <DashboardBlank
              title="今日暂无面试安排"
              action="去「面试管理」新增一条面试记录"
              href="#interviews"
              icon={CalendarDays}
            />
          ) : (
            <ul className="today-interview-list">
              {data.today_interviews.map((interview) => (
                <li key={interview.id}>
                  <time>{formatTime(interview.starts_at)}</time>
                  <span>
                    <strong>{interview.candidate_name}</strong>
                    <small>{interview.job_title}</small>
                  </span>
                  <Badge variant="outline">{interviewMode[interview.mode] || interview.mode}</Badge>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="dashboard-card other-summary">
        <div className="dashboard-card-head">
          <h2>其他汇总</h2>
        </div>
        <div className="summary-grid">
          <AnalysisCell value={data.other_totals.open_jobs} label="在招职位" />
          <AnalysisCell value={data.other_totals.jobs} label="职位总数" />
          <AnalysisCell value={data.other_totals.interviews} label="面试记录总数" />
          <AnalysisCell value="—" label="题库题目数 · 尚未接通" />
        </div>
      </section>
    </div>
  );
}

function KpiCard({
  href,
  label,
  value,
  note,
  icon: Icon,
  tone,
}: {
  href?: string;
  label: string;
  value: number | null;
  note: string;
  icon: typeof CalendarDays;
  tone?: 'warning' | 'success';
}) {
  const content = (
    <>
      <span className="dashboard-kpi-heading">
        <span>{label}</span>
        <span className="dashboard-kpi-icon">
          <Icon aria-hidden="true" />
        </span>
      </span>
      <strong>{value ?? '—'}</strong>
      <small>{note}</small>
    </>
  );
  const className = `dashboard-kpi${tone ? ` is-${tone}` : ''}${href ? ' is-clickable' : ''}`;
  return href ? (
    <a className={className} href={href}>
      {content}
    </a>
  ) : (
    <div className={className}>{content}</div>
  );
}

function ChartCard({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <section className="dashboard-card chart-card">
      <div className="dashboard-card-head">
        <h2>{title}</h2>
        <span>{note}</span>
      </div>
      <div className="chart-body">{children}</div>
    </section>
  );
}

function MiniBarChart({ points, href }: { points: DashboardData['daily_resumes']; href: string }) {
  const max = Math.max(...points.map((point) => point.count), 1);
  return (
    <div className="mini-bars" role="img" aria-label="近十四天每日新增简历柱状图">
      {points.map((point) => (
        <a
          key={point.date}
          href={href}
          className="mini-bar-item"
          title={`${point.date}：${point.count} 份`}
        >
          <span className="mini-bar-track">
            <span
              className="mini-bar-fill"
              style={{ height: `${Math.max(4, (point.count / max) * 100)}%` }}
            />
          </span>
          <small>{point.date.slice(5)}</small>
        </a>
      ))}
    </div>
  );
}

function UnavailableBars({ labels, tone }: { labels: string[]; tone: 'warning' | 'success' }) {
  return (
    <div className={`mini-bars unavailable-bars is-${tone}`} role="img" aria-label="该统计尚未接通">
      {labels.map((label) => (
        <div className="mini-bar-item" key={label}>
          <span className="mini-bar-track">
            <span className="mini-bar-fill" />
          </span>
          <small>{label}</small>
        </div>
      ))}
    </div>
  );
}

function AnalysisCell({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="analysis-cell">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function DashboardBlank({
  title,
  action,
  href,
  icon: Icon,
}: {
  title: string;
  action: string;
  href: string;
  icon: typeof CalendarDays;
}) {
  return (
    <div className="dashboard-blank">
      <Icon aria-hidden="true" />
      <strong>{title}</strong>
      <a href={href}>{action}</a>
    </div>
  );
}

const interviewMode: Record<string, string> = { onsite: '现场', video: '视频', phone: '电话' };

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function eightWeekLabels(today: string) {
  const end = new Date(`${today}T12:00:00+08:00`);
  const labels: string[] = [];
  for (let offset = 7; offset >= 0; offset -= 1) {
    const date = new Date(end);
    date.setDate(end.getDate() - offset * 7);
    labels.push(
      date.toLocaleDateString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        month: '2-digit',
        day: '2-digit',
      }),
    );
  }
  return labels;
}
export function Jobs({ revision, openJob, canCreate, create }: WorkspaceProps) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<Job> | null>(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    setError('');
    setData(null);
    const timer = setTimeout(() => {
      void api<Page<Job>>(
        `jobs/?search=${encodeURIComponent(search)}&status=${status}&page=${page}`,
        undefined,
        c.signal,
      )
        .then(setData)
        .catch((e) => {
          if (e.name !== 'AbortError') setError(e.message);
        });
    }, 150);
    return () => {
      clearTimeout(timer);
      c.abort();
    };
  }, [search, status, page, revision, reload]);
  return (
    <section className="panel jobs-panel">
      <div className="filterbar">
        <Input
          aria-label="搜索职位或地点"
          placeholder="搜索职位名称、工作地点"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <NativeSelect
          aria-label="职位状态"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <NativeSelectOption value="">全部状态</NativeSelectOption>
          {Object.entries(jobStatus).map(([value, label]) => (
            <NativeSelectOption key={value} value={value}>
              {label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <span className="scope-note">我的授权范围{data && ` · ${data.count} 个职位`}</span>
      </div>
      {error ? (
        <ErrorNotice message={error} retry={() => setReload((r) => r + 1)} />
      ) : !data ? (
        <Loading />
      ) : data.count === 0 ? (
        <Blank
          title={search || status ? '没有符合条件的职位' : '从第一个职位开始'}
          description={
            search || status
              ? '试试调整关键词或职位状态。'
              : canCreate
                ? '先填写基本需求，再邀请用人负责人确认招人要求。'
                : '当前没有分配给你的职位，请联系负责的 HR。'
          }
        >
          {search || status ? (
            <Button
              variant="outline"
              onClick={() => {
                setSearch('');
                setStatus('');
              }}
            >
              清除筛选
            </Button>
          ) : (
            canCreate && <Button onClick={create}>新建职位</Button>
          )}
        </Blank>
      ) : (
        <>
          <div className="table-container">
            <Table<Job>
              rowKey="id"
              dataSource={data.results}
              pagination={false}
              columns={[
                {
                  title: '职位 / 工作地点',
                  dataIndex: 'title',
                  width: 280,
                  render: (_text, j) => (
                    <div>
                      <Button variant="link" className="job-link" onClick={() => openJob(j.id)}>
                        {j.title}
                      </Button>
                      <small className="cell-secondary">{j.location}</small>
                    </div>
                  ),
                },
                { title: '部门', dataIndex: 'department_name', width: 180 },
                { title: '计划人数', dataIndex: 'headcount', width: 90, render: (n) => `${n} 人` },
                { title: 'HR 负责人', dataIndex: 'owner_name', width: 130 },
                {
                  title: '招人要求',
                  dataIndex: 'latest_profile',
                  width: 170,
                  render: (_text, j) =>
                    j.latest_profile ? (
                      <span>
                        v{j.latest_profile.number} · {profileStatus[j.latest_profile.status]}
                      </span>
                    ) : (
                      '尚未填写'
                    ),
                },
                {
                  title: '职位状态',
                  dataIndex: 'status',
                  width: 100,
                  render: (s) => (
                    <Badge variant={s === 'open' ? 'default' : 'secondary'}>{jobStatus[s]}</Badge>
                  ),
                },
                {
                  title: '',
                  dataIndex: 'id',
                  width: 90,
                  render: (_text, j) => (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`查看${j.title}`}
                      onClick={() => openJob(j.id)}
                    >
                      查看
                      <ArrowRight data-icon="inline-end" />
                    </Button>
                  ),
                },
              ]}
            />
          </div>
          <Pager page={page} count={data.count} onChange={setPage} />
        </>
      )}
    </section>
  );
}
