import Table from '@douyinfe/semi-ui/lib/es/table';
import { BriefcaseBusiness, Search, Sparkles, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ErrorNotice, Loading, Pager } from '@/components/feedback';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  api,
  dateTime,
  type Job,
  jobStatus,
  kindLabel,
  type Page,
  type Requirement,
} from '@/lib/api';
import { type Application, stages, stageVariants } from '@/lib/intake';
import { cn } from '@/lib/utils';
import { ImportDrawer, ProfileCandidatePicker } from '@/pages/intake';

export type ProfileContext = {
  tab: 'jobs' | 'candidates';
  job: Pick<Job, 'id' | 'title'> | null;
};

function HrIdentity({
  name,
  avatarUrl,
  chatUrl,
}: {
  name: string;
  avatarUrl: string;
  chatUrl: string;
}) {
  const content = (
    <>
      <Avatar size="sm">
        {avatarUrl && (
          <AvatarImage src={avatarUrl} alt={`${name}的头像`} referrerPolicy="no-referrer" />
        )}
        <AvatarFallback>{Array.from(name.trim())[0] || 'H'}</AvatarFallback>
      </Avatar>
      <span>{name}</span>
    </>
  );
  return chatUrl ? (
    <a
      href={chatUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`在飞书中与${name}私聊`}
      title="打开飞书私聊"
      className={cn(buttonVariants({ variant: 'link' }), 'h-auto justify-start gap-2 p-0')}
    >
      {content}
    </a>
  ) : (
    <div className="flex items-center gap-2 whitespace-nowrap" title="尚未绑定飞书，暂不能发起私聊">
      {content}
    </div>
  );
}

export function TalentProfiles({
  openApplication,
  context,
  setContext,
  create,
  changed,
  ...props
}: {
  revision: number;
  openJob: (id: number, edit?: boolean) => void;
  openApplication: (id: number) => void;
  canCreate: boolean;
  context: ProfileContext;
  setContext: (context: ProfileContext) => void;
  create: () => void;
  changed: () => void;
}) {
  const [choosing, setChoosing] = useState(false);
  const [importJob, setImportJob] = useState<Job | null>(null);
  const [jobDetails, setJobDetails] = useState<Job | null>(null);
  const [jobError, setJobError] = useState('');
  const [jobReload, setJobReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setJobDetails(null);
    setJobError('');
    if (context.job) {
      api<Job>(`jobs/${context.job.id}/`, undefined, controller.signal)
        .then(setJobDetails)
        .catch((e) => {
          if (e.name !== 'AbortError') setJobError(e.message);
        });
    }
    return () => controller.abort();
  }, [context.job, props.revision, jobReload]);
  const canChoose = context.job
    ? jobDetails?.permissions.edit && jobDetails.status === 'open' && jobDetails.active_profile
    : props.canCreate;
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>人才画像</h1>
          <p>
            {context.tab === 'jobs'
              ? '先确定招人要求，再选择简历，看看写到了什么、还需要问什么。'
              : '按职位查看应聘记录，用本次简历对照招人要求。AI 提供依据，由你核实。'}
          </p>
        </div>
        <div className="page-actions">
          {context.tab === 'jobs' ? (
            props.canCreate && (
              <Button onClick={create}>
                <Sparkles data-icon="inline-start" />
                AI 起草招人要求
              </Button>
            )
          ) : canChoose ? (
            <Button onClick={() => setChoosing(true)}>
              <Users data-icon="inline-start" />
              选择候选人
            </Button>
          ) : null}
        </div>
      </div>
      <Tabs
        value={context.tab}
        onValueChange={(tab) => setContext({ ...context, tab: tab as ProfileContext['tab'] })}
        className="gap-4"
      >
        <TabsList aria-label="人才画像类型">
          <TabsTrigger value="jobs">招人要求</TabsTrigger>
          <TabsTrigger value="candidates">简历对照</TabsTrigger>
        </TabsList>
        <TabsContent value="jobs">
          <JobProfiles {...props} chooseJob={(job) => setContext({ tab: 'candidates', job })} />
        </TabsContent>
        <TabsContent value="candidates">
          {jobError && (
            <ErrorNotice message={jobError} retry={() => setJobReload((value) => value + 1)} />
          )}
          <CandidateProfiles
            key={context.job?.id ?? 'all'}
            revision={props.revision}
            openApplication={openApplication}
            selectedJob={context.job}
            selectJob={(job) => setContext({ tab: 'candidates', job })}
            chooseCandidate={canChoose ? () => setChoosing(true) : undefined}
          />
          {jobDetails && !canChoose && (
            <p className="mt-3 text-sm text-muted-foreground">
              {!jobDetails.permissions.edit
                ? '你可以查看要求；选择人选需要这个职位的操作权限。'
                : '此职位需要已启用招人要求并开始招聘，才能加入候选人。'}
              <Button variant="link" onClick={() => props.openJob(jobDetails.id)}>
                查看职位
              </Button>
            </p>
          )}
        </TabsContent>
      </Tabs>
      {choosing && (
        <ProfileCandidatePicker
          initialJob={context.job}
          close={() => setChoosing(false)}
          importResume={(job) => {
            setChoosing(false);
            setImportJob(job);
          }}
          openApplication={(id) => {
            setChoosing(false);
            changed();
            openApplication(id);
          }}
        />
      )}
      {importJob && (
        <ImportDrawer
          id="new"
          initialJob={importJob}
          changed={changed}
          close={() => setImportJob(null)}
          openApplication={(id) => {
            setImportJob(null);
            changed();
            openApplication(id);
          }}
        />
      )}
    </>
  );
}

function CandidateProfiles({
  revision,
  openApplication,
  selectedJob,
  selectJob,
  chooseCandidate,
}: {
  revision: number;
  openApplication: (id: number) => void;
  selectedJob: ProfileContext['job'];
  selectJob: (job: ProfileContext['job']) => void;
  chooseCandidate?: () => void;
}) {
  const [search, setSearch] = useState('');
  const job = selectedJob ? String(selectedJob.id) : '';
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [data, setData] = useState<Page<Application> | null>(null);
  const [jobs, setJobs] = useState<{ job_id: number; job__title: string }[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError('');
    const query = new URLSearchParams({ search, job, page: String(page) });
    Promise.all([
      api<Page<Application>>(`applications/?${query}`, undefined, controller.signal),
      api<{ jobs: { job_id: number; job__title: string }[] }>(
        'applications/filter-options/',
        undefined,
        controller.signal,
      ),
    ])
      .then(([next, options]) => {
        setData(next);
        setJobs(options.jobs);
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message);
      });
    return () => controller.abort();
  }, [search, job, page, reload, revision]);
  return (
    <section className="panel" aria-label="候选人画像工作台">
      <FieldGroup className="grid items-center gap-2.5 border-b px-[26px] py-5 sm:grid-cols-[minmax(0,1fr)_220px_auto]">
        <Field>
          <FieldLabel className="sr-only" htmlFor="profile-candidate-search">
            搜索候选人或职位
          </FieldLabel>
          <Input
            id="profile-candidate-search"
            placeholder="搜索候选人或职位..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </Field>
        <Field>
          <FieldLabel className="sr-only" id="profile-job-label" htmlFor="profile-job">
            目标职位
          </FieldLabel>
          <NativeSelect
            id="profile-job"
            aria-labelledby="profile-job-label"
            value={job}
            onChange={(e) => {
              const next = jobs.find((item) => String(item.job_id) === e.target.value);
              selectJob(next ? { id: next.job_id, title: next.job__title } : null);
            }}
          >
            <NativeSelectOption value="">全部职位</NativeSelectOption>
            {selectedJob && !jobs.some((item) => item.job_id === selectedJob.id) && (
              <NativeSelectOption value={String(selectedJob.id)}>
                {selectedJob.title}
              </NativeSelectOption>
            )}
            {jobs.map((item) => (
              <NativeSelectOption key={item.job_id} value={String(item.job_id)}>
                {item.job__title}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Button
          variant="outline"
          className="h-[42px] px-3.5"
          onClick={() => {
            setSearch('');
            selectJob(null);
            setPage(1);
          }}
        >
          重置
        </Button>
      </FieldGroup>
      {error ? (
        <ErrorNotice message={error} retry={() => setReload((v) => v + 1)} />
      ) : !data ? (
        <Loading />
      ) : !data.count ? (
        <Empty className="candidate-library-empty">
          <EmptyHeader>
            <EmptyMedia className="candidate-library-empty-icon">
              <Users aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>
              {search
                ? '没有找到匹配的应聘记录'
                : selectedJob
                  ? `“${selectedJob.title}”还没有应聘记录`
                  : '还没有可对照的应聘记录'}
            </EmptyTitle>
            <EmptyDescription>
              {search
                ? '换个名字搜索，或清除筛选查看已有记录。'
                : '先选择本系统已有候选人，再补充本次应聘的简历。已有记录会直接打开。'}
            </EmptyDescription>
          </EmptyHeader>
          {search ? (
            <Button
              variant="outline"
              onClick={() => {
                setSearch('');
                setPage(1);
              }}
            >
              清除搜索
            </Button>
          ) : (
            chooseCandidate && <Button onClick={chooseCandidate}>选择候选人</Button>
          )}
        </Empty>
      ) : (
        <>
          <div className="table-container">
            <Table<Application>
              rowKey="id"
              dataSource={data.results}
              pagination={false}
              columns={[
                {
                  title: '候选人',
                  dataIndex: 'name',
                  render: (_value, item) => (
                    <div className="flex flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          variant="link"
                          className="job-link"
                          onClick={() => openApplication(item.id)}
                        >
                          {item.name}
                        </Button>
                        {item.candidate_deleted_at && (
                          <Badge variant="destructive">已移出候选人库</Badge>
                        )}
                      </div>
                      {item.candidate_deleted_at && item.closed_at === null && (
                        <small className="text-warning">原应聘待处理</small>
                      )}
                    </div>
                  ),
                },
                { title: '目标职位', dataIndex: 'job_title' },
                { title: '本次应聘', dataIndex: 'attempt_no', render: (value) => `第 ${value} 次` },
                {
                  title: '当前阶段',
                  dataIndex: 'stage',
                  render: (value) => (
                    <Badge variant={stageVariants[value] || 'muted'}>
                      {stages[value] || value}
                    </Badge>
                  ),
                },
                {
                  title: '经办 HR',
                  dataIndex: 'owner_name',
                  render: (_value, item) => (
                    <HrIdentity
                      name={item.owner_name}
                      avatarUrl={item.owner_avatar_url}
                      chatUrl={item.owner_chat_url}
                    />
                  ),
                },
                {
                  title: '下一步',
                  dataIndex: 'id',
                  render: (_value, item) => (
                    <Button variant="outline" onClick={() => openApplication(item.id)}>
                      {item.candidate_deleted_at ? '处理原有应聘' : '查看简历并对照'}
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

function JobProfiles({
  revision,
  openJob,
  canCreate,
  chooseJob,
}: {
  revision: number;
  openJob: (id: number, edit?: boolean) => void;
  canCreate: boolean;
  chooseJob: (job: Job) => void;
}) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [data, setData] = useState<Page<Job> | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError('');
    const query = new URLSearchParams({ search, status, page: String(page) });
    api<Page<Job>>(`jobs/?${query}`, undefined, controller.signal)
      .then(setData)
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message);
      });
    return () => controller.abort();
  }, [search, status, page, reload, revision]);
  return (
    <section className="panel" aria-label="岗位画像工作台">
      <FieldGroup className="grid items-center gap-2.5 border-b px-[26px] py-5 sm:grid-cols-[minmax(0,1fr)_180px_auto]">
        <Field>
          <FieldLabel className="sr-only" htmlFor="talent-search">
            搜索职位
          </FieldLabel>
          <div className="jobs-search">
            <Search aria-hidden="true" />
            <Input
              id="talent-search"
              className="jobs-search-input"
              placeholder="搜索职位名称或工作地点..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
        </Field>
        <Field>
          <FieldLabel className="sr-only" id="talent-status-label" htmlFor="talent-status">
            职位状态
          </FieldLabel>
          <NativeSelect
            id="talent-status"
            className="w-full"
            aria-labelledby="talent-status-label"
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
        </Field>
        <Button
          variant="outline"
          className="h-[42px] px-3.5"
          onClick={() => {
            setSearch('');
            setStatus('');
            setPage(1);
          }}
        >
          重置
        </Button>
      </FieldGroup>
      {error ? (
        <ErrorNotice message={error} retry={() => setReload((v) => v + 1)} />
      ) : !data ? (
        <Loading />
      ) : data.count === 0 ? (
        <Empty className="candidate-library-empty">
          <EmptyHeader>
            <EmptyMedia className="candidate-library-empty-icon">
              <BriefcaseBusiness aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>{search || status ? '没有符合条件的职位' : '还没有数据'}</EmptyTitle>
            <EmptyDescription>
              {search || status
                ? '调整筛选后再试，已保存的画像不会改变。'
                : canCreate
                  ? '点击右上角「AI 起草招人要求」，写下要招什么人，核对后保存使用。'
                  : '获得职位查看权限后，可在这里查看岗位标准。'}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <div className="table-container">
            <Table<Job>
              rowKey="id"
              dataSource={data.results}
              pagination={false}
              columns={[
                {
                  title: '职位',
                  dataIndex: 'title',
                  render: (_value, job) => (
                    <div>
                      <Button variant="link" className="job-link" onClick={() => openJob(job.id)}>
                        {job.title}
                      </Button>
                      <small className="cell-secondary">
                        {job.department_name} · {job.location}
                      </small>
                    </div>
                  ),
                },
                {
                  title: '招人要求',
                  dataIndex: 'active_profile_number',
                  render: (value) => (
                    <Badge variant={value ? 'success' : 'warning'}>
                      {value ? '已确定，可以对照简历' : '尚未确定'}
                    </Badge>
                  ),
                },
                {
                  title: '未完成的修改',
                  dataIndex: 'latest_profile',
                  render: (_value, job) => {
                    const p = job.latest_profile;
                    return p && p.id !== job.active_profile ? '有草稿，尚未使用' : '—';
                  },
                },
                {
                  title: '经办 HR',
                  dataIndex: 'owner_name',
                  render: (_value, job) => (
                    <HrIdentity
                      name={job.owner_name}
                      avatarUrl={job.owner_avatar_url}
                      chatUrl={job.owner_chat_url}
                    />
                  ),
                },
                {
                  title: '下一步',
                  dataIndex: 'id',
                  render: (_value, job) => (
                    <div className="flex flex-wrap gap-2">
                      {job.active_profile ? (
                        <Button onClick={() => chooseJob(job)}>查看本职位应聘</Button>
                      ) : (
                        job.permissions.edit &&
                        job.status !== 'closed' && (
                          <Button onClick={() => openJob(job.id, true)}>
                            <Sparkles data-icon="inline-start" />
                            {job.latest_profile ? '继续完善要求' : 'AI 起草招人要求'}
                          </Button>
                        )
                      )}
                      <Button variant="outline" onClick={() => openJob(job.id)}>
                        查看要求
                      </Button>
                    </div>
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

export type ProfileGeneration = {
  id: number;
  status: 'running' | 'succeeded' | 'failed' | 'stale';
  error: string;
  input: { jd: string; business_goal: string };
  requirements: Requirement[];
  created_at: string;
  job_version?: number | null;
};

export function ProfileAi({
  job,
  jd,
  businessGoal,
  busy,
  setBusy,
  restoreInput,
  adopt,
}: {
  job?: Job;
  jd: string;
  businessGoal: string;
  busy: boolean;
  setBusy: (value: boolean) => void;
  restoreInput: (input: ProfileGeneration['input']) => void;
  adopt: (generation: ProfileGeneration, requirements: Requirement[]) => void;
}) {
  const [result, setResult] = useState<ProfileGeneration | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [error, setError] = useState('');
  const [request, setRequest] = useState<{ key: string; input: string } | null>(null);
  const [history, setHistory] = useState<ProfileGeneration[] | null>(null);
  const endpoint = job ? `jobs/${job.id}/profile-ai/` : 'jobs/profile-ai/';
  function show(generation: ProfileGeneration) {
    setResult(generation);
    setSelected(generation.requirements.map((_, i) => i));
  }
  async function generate() {
    if (busy || !jd.trim()) return;
    setBusy(true);
    setError('');
    const input = JSON.stringify([job?.version, jd, businessGoal]);
    const key = request?.input === input ? request.key : crypto.randomUUID();
    setRequest({ key, input });
    try {
      const generated = await api<ProfileGeneration>(endpoint, {
        ...(job ? { version: job.version } : {}),
        request_key: key,
        jd,
        business_goal: businessGoal,
      });
      show(generated);
      if (generated.status !== 'running') setRequest(null);
      if (generated.status !== 'succeeded')
        setError(generated.error || '生成仍在处理中，稍后重试可读取同一次结果。');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const inputChanged =
    result && (result.input.jd !== jd.trim() || result.input.business_goal !== businessGoal.trim());
  const outdated = Boolean(
    job && result?.job_version != null && result.job_version !== job.version,
  );
  return (
    <section className="flex flex-col gap-4" aria-label="AI 岗位画像助手">
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={busy || !jd.trim()} onClick={() => void generate()}>
          <Sparkles data-icon="inline-start" />
          {busy ? '正在处理…' : 'AI 生成要求'}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              setHistory((await api<{ items: ProfileGeneration[] }>(endpoint)).items);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          最近 AI 草稿
        </Button>
      </div>
      <FieldDescription>
        {jd.trim()
          ? '根据职位描述和业务目标生成；选择采用、修改后再保存。AI 不会自动启用画像。'
          : '先填写招聘需求，即可生成 AI 草稿。'}
      </FieldDescription>
      {error && <ErrorNotice message={error} />}
      {history && (
        <div className="flex flex-col items-start gap-2">
          {history.length === 0 ? (
            <p>还没有生成记录。</p>
          ) : (
            history.map((item) => (
              <Button
                key={item.id}
                type="button"
                variant="link"
                disabled={busy}
                onClick={() => {
                  show(item);
                  setError(item.error || '');
                }}
              >
                {dateTime(item.created_at)} ·{' '}
                {
                  {
                    succeeded: '查看草稿',
                    running: '处理中',
                    failed: '生成失败',
                    stale: '输入已过期',
                  }[item.status]
                }
              </Button>
            ))
          )}
        </div>
      )}
      {result && inputChanged && (
        <div className="flex flex-col items-start gap-2">
          <p>这次生成保留了当时的输入。恢复会替换上方职位描述和业务目标。</p>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => restoreInput(result.input)}
          >
            恢复这次输入
          </Button>
        </div>
      )}
      {result?.status === 'succeeded' && (
        <Alert>
          <AlertTitle>AI 草稿 · 核对后采用</AlertTitle>
          <AlertDescription>
            <FieldGroup>
              {result.requirements.map((r, i) => (
                <Field
                  key={`${result.id}-${r.generation_index ?? r.text}`}
                  orientation="horizontal"
                >
                  <Checkbox
                    id={`ai-requirement-${i}`}
                    checked={selected.includes(i)}
                    disabled={busy}
                    onCheckedChange={(checked) =>
                      setSelected((items) =>
                        checked ? [...items, i] : items.filter((n) => n !== i),
                      )
                    }
                  />
                  <div className="flex min-w-0 flex-col gap-1">
                    <FieldLabel htmlFor={`ai-requirement-${i}`}>
                      {kindLabel[r.kind]} · {r.text}
                    </FieldLabel>
                    <p>{r.rationale}</p>
                    <p>
                      {r.source_kind === 'ai_suggestion'
                        ? 'AI 建议，需自行核对'
                        : `来源：${r.source_kind === 'jd' ? '职位描述' : r.source_kind === 'business_goal' ? '业务目标' : '已回答的澄清'}`}
                    </p>
                    {r.source_quote && (
                      <blockquote className="whitespace-pre-wrap break-words">
                        “{r.source_quote}”
                      </blockquote>
                    )}
                    {r.needs_verification && <Badge variant="warning">待核实</Badge>}
                  </div>
                </Field>
              ))}
              <p>采用后替换本次编辑区的要求，已保存的历史版本保持不变。</p>
              {inputChanged && <p role="status">输入材料已修改，请重新生成再采用。</p>}
              {outdated && <p role="status">职位已有更新，请基于最新职位重新生成。</p>}
              <Button
                type="button"
                disabled={busy || !selected.length || Boolean(inputChanged) || outdated}
                onClick={() => {
                  adopt(
                    result,
                    result.requirements.filter((_, i) => selected.includes(i)),
                  );
                  setResult(null);
                }}
              >
                采用这份草稿
              </Button>
            </FieldGroup>
          </AlertDescription>
        </Alert>
      )}
    </section>
  );
}
