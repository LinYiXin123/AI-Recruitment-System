import Table from '@douyinfe/semi-ui/lib/es/table';
import { BriefcaseBusiness, Search, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ErrorNotice, Loading, Pager } from '@/components/feedback';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import {
  api,
  dateTime,
  type Job,
  jobStatus,
  kindLabel,
  type Page,
  type Requirement,
} from '@/lib/api';

export function TalentProfiles({
  revision,
  openJob,
  canCreate,
}: {
  revision: number;
  openJob: (id: number, edit?: boolean) => void;
  canCreate: boolean;
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
                  ? '点击右上角「AI 起草画像」，粘贴招聘需求，核对后保存使用。'
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
                  title: '正在使用',
                  dataIndex: 'active_profile_number',
                  render: (value) => (
                    <Badge variant={value ? 'secondary' : 'outline'}>
                      {value ? `v${value} · 已生效` : '尚未使用'}
                    </Badge>
                  ),
                },
                {
                  title: '最新编辑',
                  dataIndex: 'latest_profile',
                  render: (_value, job) => {
                    const p = job.latest_profile;
                    return p
                      ? `v${p.number} · ${p.id === job.active_profile ? '使用中' : '待完善 / 使用'}`
                      : '待起草';
                  },
                },
                { title: '经办 HR', dataIndex: 'owner_name' },
                {
                  title: '下一步',
                  dataIndex: 'id',
                  render: (_value, job) => (
                    <div className="flex flex-wrap gap-2">
                      {job.permissions.edit && job.status !== 'closed' && (
                        <Button onClick={() => openJob(job.id, true)}>
                          <Sparkles data-icon="inline-start" />
                          AI 起草画像
                        </Button>
                      )}
                      <Button variant="outline" onClick={() => openJob(job.id)}>
                        查看画像
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
                    {r.needs_verification && <Badge variant="outline">待核实</Badge>}
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
