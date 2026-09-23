import Table from '@douyinfe/semi-ui/lib/es/table';
import { ArrowRight, CalendarDays, CheckCheck, Clock3, ListChecks, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Blank, ErrorNotice, Loading, Pager } from '@/components/feedback';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { api, dateTime, type Job, jobStatus, type Page, profileStatus, type Task } from '@/lib/api';

type WorkspaceProps = {
  revision: number;
  openJob: (id: number, tab?: string) => void;
  canCreate: boolean;
  create: () => void;
  openApplication?: (id: number) => void;
};
export function Today({ revision, openJob, canCreate, create, openApplication }: WorkspaceProps) {
  return (
    <div className="today-grid">
      <div className="flex flex-col gap-6">
        <TaskQueue
          scope="mine"
          revision={revision}
          openJob={openJob}
          openApplication={openApplication}
        />
        <TaskQueue
          scope="waiting"
          revision={revision}
          openJob={openJob}
          openApplication={openApplication}
        />
      </div>
      <aside className="flex flex-col gap-6">
        <section className="panel">
          <div className="panel-title">
            <h2>
              <CalendarDays />
              今日日程
            </h2>
            <Badge variant="outline">北京时间</Badge>
          </div>
          <Blank
            title="面试排期尚未开放"
            description="当前可先创建职位、确认招人要求。面试日程将在排期流程接通后呈现。"
          />
        </section>
        <section className="guide-panel">
          <ListChecks />
          <h2>先把“要找谁”说清楚</h2>
          <p>对外职位描述与内部招人要求分开保存。用人负责人确认后，再开始招聘。</p>
          {canCreate ? (
            <Button variant="outline" onClick={create}>
              <Plus data-icon="inline-start" />
              创建一个职位
            </Button>
          ) : (
            <p>你可以从待办进入已分配的确认事项。</p>
          )}
        </section>
      </aside>
    </div>
  );
}
function TaskQueue({
  scope,
  revision,
  openJob,
  openApplication,
}: {
  scope: string;
  revision: number;
  openJob: (id: number, tab?: string) => void;
  openApplication?: (id: number) => void;
}) {
  const [data, setData] = useState<Page<Task> | null>(null);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    setData(null);
    setError('');
    api<Page<Task>>(`tasks/?scope=${scope}&page=${page}`, undefined, c.signal)
      .then(setData)
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message);
      });
    return () => c.abort();
  }, [scope, revision, page, reload]);
  return (
    <section className="panel">
      <div className="panel-title">
        <h2>
          {scope === 'mine' ? <ListChecks /> : <Clock3 />}
          {scope === 'mine' ? '需要我处理' : '等待他人'}
          {data && <Badge variant="secondary">{data.count}</Badge>}
        </h2>
        <span>{scope === 'mine' ? '由早到晚' : '跟进确认进度'}</span>
      </div>
      {error ? (
        <ErrorNotice message={error} retry={() => setReload((r) => r + 1)} />
      ) : !data ? (
        <Loading />
      ) : data.count === 0 ? (
        <Blank
          title={scope === 'mine' ? '当前没有需要你处理的事项' : '当前没有等待中的事项'}
          description={
            scope === 'mine'
              ? '分配给你的澄清、要求确认、补充和招聘启动事项会出现在这里。'
              : '提交招人要求后，可在这里查看由谁接着处理。'
          }
        >
          <CheckCheck aria-hidden="true" className="text-muted-foreground" />
        </Blank>
      ) : (
        <>
          <ul className="task-list">
            {data.results.map((t) => (
              <li key={t.id}>
                <div className="task-icon">
                  <ListChecks />
                </div>
                <div className="task-body">
                  <strong>{t.job_title}</strong>
                  <p>
                    {t.application ? t.candidate_name : `招人要求 v${t.profile_number}`} ·{' '}
                    {scope === 'mine' ? t.kind_label : `等待 ${t.assignee_name} · ${t.kind_label}`}
                  </p>
                  <small>
                    {dateTime(t.created_at)} 提交{t.due_at && ` · 截止 ${dateTime(t.due_at)}`}
                  </small>
                </div>
                <Button
                  variant={scope === 'mine' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() =>
                    t.application
                      ? openApplication?.(t.application)
                      : openJob(
                          t.job_id,
                          t.kind.startsWith('clarify') ? 'clarifications' : 'requirements',
                        )
                  }
                >
                  {scope === 'mine' ? (t.kind === 'review' ? '查看并确认' : '去处理') : '查看进展'}
                  <ArrowRight data-icon="inline-end" />
                </Button>
              </li>
            ))}
          </ul>
          {data.count > 20 && <Pager page={page} count={data.count} onChange={setPage} />}
        </>
      )}
    </section>
  );
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
