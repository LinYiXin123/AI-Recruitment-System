import Select from '@douyinfe/semi-ui/lib/es/select';
import Table from '@douyinfe/semi-ui/lib/es/table';
import {
  ArrowRight,
  CalendarCheck2,
  CalendarDays,
  Check,
  Flag,
  Plus as PlusIcon,
  Search,
  UserRound,
  UsersRound,
} from 'lucide-react';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Blank, ErrorNotice, Loading } from '@/components/feedback';
import { RecruitmentSitesEditor } from '@/components/recruitment-sites';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, type DashboardData, type Job, jobStatus, type Me, type Page } from '@/lib/api';

type WorkspaceProps = {
  revision: number;
  openJob: (id: number, tab?: string) => void;
  canCreate: boolean;
  departments: Pick<Me['departments'][number], 'id' | 'name'>[];
  openApplication?: (id: number) => void;
};
type TodayProps = {
  revision: number;
  onLoaded: (data: DashboardData | null) => void;
};
export type JobsActions = { exportModule: () => void };

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
          <AnalysisCell value={data.other_totals.question_bank} label="题库题目数" />
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
export const Jobs = forwardRef<JobsActions, WorkspaceProps>(function Jobs(
  { revision, openJob, canCreate, departments },
  ref,
) {
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('');
  const [company, setCompany] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<Job> | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  const exportInProgress = useRef(false);
  const query = new URLSearchParams({ search, department, company, status, page: String(page) });
  const jobsUrl = `jobs/?${query.toString()}`;

  useEffect(() => {
    const c = new AbortController();
    setError('');
    setData(null);
    const timer = setTimeout(() => {
      void api<Page<Job>>(jobsUrl, undefined, c.signal)
        .then(setData)
        .catch((e) => {
          if (e.name !== 'AbortError') setError(e.message);
        });
    }, 150);
    return () => {
      clearTimeout(timer);
      c.abort();
    };
  }, [jobsUrl, revision, reload]);

  const departmentOptions = new Map<number, string>(departments.map(({ id, name }) => [id, name]));
  for (const job of data?.results ?? []) departmentOptions.set(job.department, job.department_name);
  const companyOptions = [
    ...new Set([company, ...(data?.results.map((job) => job.company_name) ?? [])]),
  ]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'zh-CN'));

  async function exportModule() {
    if (exportInProgress.current) return;
    exportInProgress.current = true;
    setNotice('正在准备职位导出…');
    try {
      const exportQuery = new URLSearchParams(query);
      exportQuery.delete('page');
      const rows: Job[] = [];
      let currentPage = 1;
      let total = 0;
      do {
        const response = await api<Page<Job>>(
          `jobs/?${exportQuery.toString()}&page=${currentPage}`,
        );
        total = response.count;
        rows.push(...response.results);
        currentPage += 1;
      } while (rows.length < total);

      const csv = [
        [
          '职位名称',
          '所属部门',
          '所属企业',
          '职级',
          '薪资区间',
          '招聘网站',
          '招聘人数',
          '状态',
          '发布时间',
          '工作地点',
        ],
        ...rows.map((job) => [
          job.title,
          job.department_name,
          job.company_name || '—',
          job.job_level || '—',
          job.salary_range || '—',
          job.recruitment_sites?.join('、') || '—',
          job.headcount,
          jobStatus[job.status] || job.status,
          job.planned_publish_date || '—',
          job.location,
        ]),
      ]
        .map((row) => row.map(csvCell).join(','))
        .join('\r\n');
      const url = URL.createObjectURL(
        new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = '职位管理.csv';
      link.click();
      URL.revokeObjectURL(url);
      setNotice(`已导出当前授权范围内的 ${rows.length} 个职位。`);
    } catch (e) {
      setNotice(`导出未完成：${(e as Error).message}`);
    } finally {
      exportInProgress.current = false;
    }
  }

  useImperativeHandle(ref, () => ({ exportModule: () => void exportModule() }));

  return (
    <>
      {notice && (
        <Alert className="candidate-library-notice">
          <AlertTitle>职位管理提示</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}
      <section className="panel jobs-panel" aria-label="职位列表">
        <div className="jobs-filterbar">
          <div className="jobs-search">
            <Search aria-hidden="true" />
            <Input
              aria-label="搜索职位或地点"
              className="jobs-search-input"
              placeholder="搜索职位或地点"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <span id="jobs-department-label" className="sr-only">
            按部门筛选职位
          </span>
          <Select
            aria-labelledby="jobs-department-label"
            className="jobs-filter-select"
            value={department}
            clickToHide
            dropdownClassName="candidate-select-dropdown"
            onChange={(value) => {
              setDepartment(typeof value === 'string' ? value : '');
              setPage(1);
            }}
          >
            <Select.Option value="">全部部门</Select.Option>
            {[...departmentOptions].map(([id, name]) => (
              <Select.Option key={id} value={String(id)}>
                {name}
              </Select.Option>
            ))}
          </Select>
          <span id="jobs-company-label" className="sr-only">
            按企业筛选职位
          </span>
          <Select
            aria-labelledby="jobs-company-label"
            className="jobs-filter-select"
            value={company}
            clickToHide
            dropdownClassName="candidate-select-dropdown"
            onChange={(value) => {
              setCompany(typeof value === 'string' ? value : '');
              setPage(1);
            }}
          >
            <Select.Option value="">全部企业</Select.Option>
            {companyOptions.map((name) => (
              <Select.Option key={name} value={name}>
                {name}
              </Select.Option>
            ))}
          </Select>
          <span id="jobs-status-label" className="sr-only">
            按状态筛选职位
          </span>
          <Select
            aria-labelledby="jobs-status-label"
            className="jobs-filter-select"
            value={status}
            clickToHide
            dropdownClassName="candidate-select-dropdown"
            onChange={(value) => {
              setStatus(typeof value === 'string' ? value : '');
              setPage(1);
            }}
          >
            <Select.Option value="">全部状态</Select.Option>
            {Object.entries(jobStatus).map(([value, label]) => (
              <Select.Option key={value} value={value}>
                {label}
              </Select.Option>
            ))}
          </Select>
          <Button
            variant="outline"
            onClick={() => {
              setSearch('');
              setDepartment('');
              setCompany('');
              setStatus('');
              setPage(1);
            }}
          >
            重置
          </Button>
        </div>
        {error ? (
          <ErrorNotice message={error} retry={() => setReload((r) => r + 1)} />
        ) : !data ? (
          <Loading />
        ) : (
          <>
            <div className="table-container">
              <Table<Job>
                rowKey="id"
                dataSource={data.results}
                pagination={false}
                empty={
                  <Blank
                    title={
                      search || department || company || status
                        ? '没有符合条件的职位'
                        : '从第一个职位开始'
                    }
                    description={
                      search || department || company || status
                        ? '换个关键词或清空筛选条件再试试。'
                        : canCreate
                          ? '先填写基本需求，再由 HR 核对岗位要求并保存使用。'
                          : '当前没有分配给你的职位，请联系负责的 HR。'
                    }
                  >
                    {(search || department || company || status) && (
                      <Button
                        variant="outline"
                        onClick={() => {
                          setSearch('');
                          setDepartment('');
                          setCompany('');
                          setStatus('');
                          setPage(1);
                        }}
                      >
                        清空筛选
                      </Button>
                    )}
                  </Blank>
                }
                columns={[
                  {
                    title: '职位名称',
                    dataIndex: 'title',
                    width: 120,
                    render: (_text, j) => (
                      <div>
                        <Button variant="link" className="job-link" onClick={() => openJob(j.id)}>
                          {j.title}
                        </Button>
                        <small className="cell-secondary">工作地点 · {j.location}</small>
                      </div>
                    ),
                  },
                  { title: '所属部门', dataIndex: 'department_name', width: 80 },
                  {
                    title: '所属企业',
                    dataIndex: 'company_name',
                    width: 78,
                    render: (value) => value || '—',
                  },
                  {
                    title: '职级',
                    dataIndex: 'job_level',
                    width: 60,
                    render: (value) => value || '—',
                  },
                  {
                    title: '薪资区间',
                    dataIndex: 'salary_range',
                    width: 120,
                    render: (value) => value || '—',
                  },
                  {
                    title: '招聘网站',
                    dataIndex: 'recruitment_sites',
                    width: 120,
                    render: (_value, job) => (
                      <RecruitmentSitesEditor
                        job={job}
                        onSaved={(updated) =>
                          setData((current) =>
                            current
                              ? {
                                  ...current,
                                  results: current.results.map((item) =>
                                    item.id === updated.id && updated.version >= item.version
                                      ? updated
                                      : item,
                                  ),
                                }
                              : current,
                          )
                        }
                      />
                    ),
                  },
                  {
                    title: '招聘人数',
                    dataIndex: 'headcount',
                    width: 68,
                    render: (n) => `${n} 人`,
                  },
                  {
                    title: '状态',
                    dataIndex: 'status',
                    width: 68,
                    render: (s) => (
                      <Badge variant={s === 'open' ? 'default' : 'secondary'}>{jobStatus[s]}</Badge>
                    ),
                  },
                  {
                    title: '发布时间',
                    dataIndex: 'planned_publish_date',
                    width: 80,
                    render: (value) => value || '—',
                  },
                  {
                    title: '操作',
                    dataIndex: 'id',
                    width: 76,
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
            <div className="pager">
              <span>
                共 {data.count} 条，第 {page} / {Math.max(1, Math.ceil(data.count / 20))} 页
              </span>
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(1)}>
                首页
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                上一页
              </Button>
              <Button size="sm" aria-current="page" disabled>
                {page}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={page * 20 >= data.count}
                onClick={() => setPage(page + 1)}
              >
                下一页
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={page * 20 >= data.count}
                onClick={() => setPage(Math.max(1, Math.ceil(data.count / 20)))}
              >
                末页
              </Button>
            </div>
          </>
        )}
      </section>
    </>
  );
});

function csvCell(value: string | number | null | undefined) {
  let text = String(value ?? '');
  if (/^\s*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
