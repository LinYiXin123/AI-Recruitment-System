import Modal from '@douyinfe/semi-ui/lib/es/modal';
import Table from '@douyinfe/semi-ui/lib/es/table';
import { BriefcaseBusiness } from 'lucide-react';
import { forwardRef, type ReactNode, useEffect, useImperativeHandle, useState } from 'react';
import { ErrorNotice, Loading, Pager } from '@/components/feedback';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { api, dateTime, type Job, kindLabel, type Page } from '@/lib/api';
import {
  type Application,
  type Batch,
  type Candidate,
  type ImportItem,
  reviewActions,
  stages,
} from '@/lib/intake';
import { ScheduleInterview } from '@/pages/interviews';

function Drawer({
  title,
  close,
  busy,
  dirty,
  children,
}: {
  title: string;
  close: () => void;
  busy: boolean;
  dirty: boolean;
  children: ReactNode;
}) {
  useEffect(() => {
    const leave = (e: BeforeUnloadEvent) => {
      if (dirty || busy) e.preventDefault();
    };
    window.addEventListener('beforeunload', leave);
    return () => window.removeEventListener('beforeunload', leave);
  }, [dirty, busy]);
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !busy && (!dirty || window.confirm('还有未保存的内容，确定离开吗？'))) close();
      }}
    >
      <SheetContent className="job-sheet">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>只处理你有权限的职位和本次应聘。</SheetDescription>
        </SheetHeader>
        <div className="sheet-scroll flex flex-1 flex-col gap-5 p-5">{children}</div>
      </SheetContent>
    </Sheet>
  );
}

function JobPicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [count, setCount] = useState(0);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    setError('');
    api<Page<Job>>(
      `jobs/?status=open&search=${encodeURIComponent(search)}&page=${page}`,
      undefined,
      c.signal,
    )
      .then((data) => {
        setJobs(data.results.filter((j) => j.permissions.edit));
        setCount(data.count);
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message);
      });
    return () => c.abort();
  }, [page, search, reload]);
  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="job-search">查找招聘中的职位</FieldLabel>
        <Input
          id="job-search"
          value={search}
          disabled={disabled}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
            onChange('');
          }}
          placeholder="按职位名搜索"
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="target-job">目标职位</FieldLabel>
        <NativeSelect
          id="target-job"
          required
          disabled={disabled}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <NativeSelectOption value="">请选择已开始招聘的职位</NativeSelectOption>
          {jobs.map((j) => (
            <NativeSelectOption key={j.id} value={j.id}>
              {j.title} · {j.department_name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      {error && <ErrorNotice message={error} retry={() => setReload((r) => r + 1)} />}
      {count > 20 && !disabled && (
        <Pager
          count={count}
          page={page}
          onChange={(p) => {
            setPage(p);
            onChange('');
          }}
        />
      )}
    </FieldGroup>
  );
}

type CandidateFilterOptions = {
  jobs: { job_id: number; job__title: string }[];
  sources: string[];
  owners: { owner_id: number; owner__user__first_name: string; owner__user__username: string }[];
};

export type CandidateLibraryActions = {
  exportModule: () => void;
  openCreateCandidate: () => void;
  showMailboxSyncStatus: () => void;
};

const emptyCandidateFilters: CandidateFilterOptions = { jobs: [], sources: [], owners: [] };

export const Candidates = forwardRef<
  CandidateLibraryActions,
  {
    revision: number;
    openApplication: (id: number) => void;
    changed: () => void;
  }
>(function Candidates({ revision, openApplication, changed }, ref) {
  const [search, setSearch] = useState('');
  const [stage, setStage] = useState('');
  const [job, setJob] = useState('');
  const [source, setSource] = useState('');
  const [owner, setOwner] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<Application> | null>(null);
  const [filters, setFilters] = useState<CandidateFilterOptions>(emptyCandidateFilters);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState<number | 'new' | null>(null);
  const [exporting, setExporting] = useState(false);

  const query = new URLSearchParams({ page: String(page) });
  if (search) query.set('search', search);
  if (stage) query.set('stage', stage);
  if (job) query.set('job', job);
  if (source) query.set('source', source);
  if (owner) query.set('owner', owner);
  const applicationUrl = `applications/?${query.toString()}`;

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError('');
    api<Page<Application>>(applicationUrl, undefined, controller.signal)
      .then(setData)
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message);
      });
    return () => controller.abort();
  }, [applicationUrl, revision, reload]);

  useEffect(() => {
    const controller = new AbortController();
    api<CandidateFilterOptions>('applications/filter-options/', undefined, controller.signal)
      .then(setFilters)
      .catch(() => setFilters(emptyCandidateFilters));
    return () => controller.abort();
  }, [revision, reload]);

  function resetFilters() {
    setSearch('');
    setStage('');
    setJob('');
    setSource('');
    setOwner('');
    setPage(1);
  }

  async function exportModule() {
    if (exporting) return;
    setExporting(true);
    setNotice('');
    try {
      const exportQuery = new URLSearchParams(query);
      exportQuery.delete('page');
      const rows: Application[] = [];
      let currentPage = 1;
      let total = 0;
      do {
        const response = await api<Page<Application>>(
          `applications/?${exportQuery.toString()}&page=${currentPage}`,
        );
        total = response.count;
        rows.push(...response.results);
        currentPage += 1;
      } while (rows.length < total);
      const csv = [
        ['候选人', '本次职位', '应聘次数', '应聘阶段', '接手 HR', '来源'],
        ...rows.map((item) => [
          item.name,
          item.job_title,
          `第 ${item.attempt_no} 次`,
          stages[item.stage],
          item.owner_name,
          item.source,
        ]),
      ]
        .map((row) => row.map((cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(','))
        .join('\r\n');
      const url = URL.createObjectURL(
        new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = '候选人库.csv';
      link.click();
      URL.revokeObjectURL(url);
      setNotice(`已导出当前授权范围内的 ${rows.length} 条应聘记录。`);
    } catch (e) {
      setNotice(`导出未完成：${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
  }

  useImperativeHandle(ref, () => ({
    exportModule: () => void exportModule(),
    openCreateCandidate: () => setCreating(true),
    showMailboxSyncStatus: () =>
      setNotice('邮箱同步尚未接通。当前可通过“新增候选人”中的简历导入流程录入材料。'),
  }));

  return (
    <>
      {notice && (
        <Alert className="candidate-library-notice">
          <AlertTitle>候选人库提示</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}
      <section className="panel candidate-library-panel" aria-label="候选人库">
        <div className="candidate-filterbar">
          <Input
            aria-label="搜索候选人"
            className="candidate-search"
            placeholder="搜索..."
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
          <NativeSelect
            aria-label="筛选职位"
            value={job}
            onChange={(event) => {
              setJob(event.target.value);
              setPage(1);
            }}
          >
            <NativeSelectOption value="">全部</NativeSelectOption>
            {filters.jobs.map((item) => (
              <NativeSelectOption key={item.job_id} value={item.job_id}>
                {item.job__title}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <NativeSelect
            aria-label="筛选阶段"
            value={stage}
            onChange={(event) => {
              setStage(event.target.value);
              setPage(1);
            }}
          >
            <NativeSelectOption value="">全部</NativeSelectOption>
            {Object.entries(stages).map(([value, label]) => (
              <NativeSelectOption key={value} value={value}>
                {label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <NativeSelect
            aria-label="筛选来源"
            value={source}
            onChange={(event) => {
              setSource(event.target.value);
              setPage(1);
            }}
          >
            <NativeSelectOption value="">全部</NativeSelectOption>
            {filters.sources.map((item) => (
              <NativeSelectOption key={item} value={item}>
                {item}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <NativeSelect
            aria-label="筛选接手 HR"
            value={owner}
            onChange={(event) => {
              setOwner(event.target.value);
              setPage(1);
            }}
          >
            <NativeSelectOption value="">全部</NativeSelectOption>
            {filters.owners.map((item) => (
              <NativeSelectOption key={item.owner_id} value={item.owner_id}>
                {item.owner__user__first_name || item.owner__user__username}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <Button type="button" variant="outline" size="sm" onClick={resetFilters}>
            重置
          </Button>
        </div>
        {error ? (
          <ErrorNotice message={error} retry={() => setReload((value) => value + 1)} />
        ) : !data ? (
          <Loading />
        ) : !data.count ? (
          <Empty className="candidate-library-empty">
            <EmptyHeader>
              <EmptyMedia className="candidate-library-empty-icon">
                <BriefcaseBusiness aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>还没有数据</EmptyTitle>
              <EmptyDescription>点击右上角「新增候选人」开始录入第一条</EmptyDescription>
            </EmptyHeader>
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
                    width: 180,
                    render: (_, application) => (
                      <Button variant="link" onClick={() => openApplication(application.id)}>
                        {application.name}
                      </Button>
                    ),
                  },
                  { title: '本次职位', dataIndex: 'job_title', width: 230 },
                  {
                    title: '次数',
                    width: 90,
                    render: (_, application) => `第 ${application.attempt_no} 次`,
                  },
                  {
                    title: '应聘阶段',
                    width: 150,
                    render: (_, application) => (
                      <Badge variant="secondary">{stages[application.stage]}</Badge>
                    ),
                  },
                  { title: '接手 HR', dataIndex: 'owner_name', width: 130 },
                  { title: '来源', dataIndex: 'source', width: 180 },
                ]}
              />
            </div>
            <Pager count={data.count} page={page} onChange={setPage} />
          </>
        )}
      </section>
      {creating && (
        <CreateCandidateDialog
          close={() => setCreating(false)}
          openImport={() => {
            setCreating(false);
            setImporting('new');
          }}
          saved={(application) => {
            setCreating(false);
            changed();
            openApplication(application);
          }}
        />
      )}
      {importing !== null && (
        <ImportDrawer
          id={importing}
          close={() => setImporting(null)}
          changed={changed}
          openApplication={(id) => {
            setImporting(null);
            openApplication(id);
          }}
        />
      )}
    </>
  );
});

function CreateCandidateDialog({
  close,
  openImport,
  saved,
}: {
  close: () => void;
  openImport: () => void;
  saved: (application: number) => void;
}) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [contactNote, setContactNote] = useState('');
  const [job, setJob] = useState('');
  const [source, setSource] = useState('人工录入');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    const controller = new AbortController();
    api<Page<Job>>('jobs/?status=open&page=1', undefined, controller.signal)
      .then((response) => setJobs(response.results.filter((item) => item.permissions.edit)))
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message);
      });
    return () => controller.abort();
  }, []);

  return (
    <Modal
      visible
      centered
      width={940}
      title="新增候选人"
      className="candidate-create-modal"
      maskClosable={!busy}
      closable={!busy}
      onCancel={close}
      footer={
        <div className="candidate-create-footer">
          <Button type="button" variant="outline" disabled={busy} onClick={close}>
            取消
          </Button>
          <Button type="submit" form="create-candidate-form" disabled={busy || !job}>
            {busy ? '正在保存…' : '保存'}
          </Button>
        </div>
      }
    >
      <form
        id="create-candidate-form"
        className="candidate-create-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          try {
            const result = await api<{ candidate: number; application: number }>('candidates/', {
              request_key: requestKey,
              display_name: name,
              phone,
              email,
              contact_note: contactNote,
              job: Number(job),
              source,
            });
            saved(result.application);
          } catch (e) {
            setError((e as Error).message);
            setRequestKey(crypto.randomUUID());
          } finally {
            setBusy(false);
          }
        }}
      >
        <Button
          type="button"
          variant="outline"
          className="candidate-resume-choice"
          onClick={openImport}
          disabled={busy}
        >
          <span>简历文件</span>
          <span>
            拖拽简历到此处，或 <strong>点击选择文件</strong>
          </span>
          <small>支持 PDF、Word、纯文本和图片；导入后会先进行文字提取与身份核对。</small>
        </Button>
        {error && <ErrorNotice message={error} />}
        <FieldGroup className="candidate-create-grid">
          <Field>
            <FieldLabel htmlFor="new-candidate-name">姓名 *</FieldLabel>
            <Input
              id="new-candidate-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={100}
              disabled={busy}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="new-candidate-phone">联系方式</FieldLabel>
            <Input
              id="new-candidate-phone"
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="手机号"
              maxLength={32}
              disabled={busy}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="new-candidate-contact-note">联系方式说明</FieldLabel>
            <Input
              id="new-candidate-contact-note"
              value={contactNote}
              onChange={(event) => setContactNote(event.target.value)}
              placeholder="没有联系方式时请说明待补充情况"
              maxLength={500}
              disabled={busy}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="new-candidate-email">邮箱</FieldLabel>
            <Input
              id="new-candidate-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              maxLength={254}
              disabled={busy}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="new-candidate-job">应聘职位 *</FieldLabel>
            <NativeSelect
              id="new-candidate-job"
              value={job}
              onChange={(event) => setJob(event.target.value)}
              required
              disabled={busy}
            >
              <NativeSelectOption value="">请选择职位</NativeSelectOption>
              {jobs.map((item) => (
                <NativeSelectOption key={item.id} value={item.id}>
                  {item.title} · {item.department_name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="new-candidate-source">简历来源</FieldLabel>
            <NativeSelect
              id="new-candidate-source"
              value={source}
              onChange={(event) => setSource(event.target.value)}
              disabled={busy}
            >
              <NativeSelectOption value="人工录入">人工录入</NativeSelectOption>
              <NativeSelectOption value="本人投递">本人投递</NativeSelectOption>
              <NativeSelectOption value="员工推荐">员工推荐</NativeSelectOption>
              <NativeSelectOption value="猎头推荐">猎头推荐</NativeSelectOption>
            </NativeSelect>
          </Field>
        </FieldGroup>
      </form>
    </Modal>
  );
}

function ImportDrawer({
  id,
  close,
  changed,
  openApplication,
}: {
  id: number | 'new';
  close: () => void;
  changed: () => void;
  openApplication: (id: number) => void;
}) {
  const [batch, setBatch] = useState<Batch | null>(null);
  const [job, setJob] = useState('');
  const [source, setSource] = useState('');
  const [files, setFiles] = useState<{ file: File; key: string; error: string; done: boolean }[]>(
    [],
  );
  const [key] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [active, setActive] = useState<ImportItem | null>(null);
  useEffect(() => {
    if (id === 'new') return;
    const c = new AbortController();
    api<Batch>(`imports/${id}/`, undefined, c.signal)
      .then(setBatch)
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message);
      });
    return () => c.abort();
  }, [id]);
  async function refresh(batchId: number) {
    const b = await api<Batch>(`imports/${batchId}/`);
    setBatch(b);
    changed();
  }
  async function sendFiles() {
    setBusy(true);
    setError('');
    try {
      const b =
        batch ||
        (await api<Batch>('imports/', {
          request_key: key,
          job: Number(job),
          source,
          total: files.length,
        }));
      setBatch(b);
      for (const row of files) {
        if (row.done) continue;
        const data = new FormData();
        data.set('request_key', row.key);
        data.set('file', row.file);
        try {
          await api(`imports/${b.id}/upload/`, data);
          setFiles((old) =>
            old.map((f) => (f.key === row.key ? { ...f, done: true, error: '' } : f)),
          );
        } catch (e) {
          setFiles((old) =>
            old.map((f) => (f.key === row.key ? { ...f, error: (e as Error).message } : f)),
          );
        }
      }
      await refresh(b.id);
      setDirty(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Drawer
      title={batch ? `简历导入 · ${batch.job_title}` : '导入简历'}
      close={close}
      busy={busy}
      dirty={dirty}
    >
      {error && (
        <ErrorNotice
          message={error}
          retry={() => {
            setError('');
            if (batch) void refresh(batch.id).catch((e) => setError(e.message));
          }}
        />
      )}
      {!batch && id !== 'new' ? (
        <Loading />
      ) : !batch ? (
        <form
          className="flex flex-col gap-4"
          onChange={() => setDirty(true)}
          onSubmit={(e) => {
            e.preventDefault();
            void sendFiles();
          }}
        >
          <fieldset disabled={busy} className="flex flex-col gap-4">
            <JobPicker value={job} onChange={setJob} disabled={busy} />
            <Field>
              <FieldLabel htmlFor="import-source">材料来源</FieldLabel>
              <Input
                id="import-source"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder="例如：本人投递、经本人同意转交"
                required
                maxLength={200}
              />
            </Field>
            <FileChoice disabled={busy} select={setFiles} />
            <Button type="submit" disabled={busy || !files.length || !job}>
              {busy ? '正在接收与提取…' : '开始导入'}
            </Button>
          </fieldset>
        </form>
      ) : (
        <>
          <Alert>
            <AlertTitle>
              已接收 {batch.received} / {batch.total} 份，已核对 {batch.completed} 份
            </AlertTitle>
            <AlertDescription>
              自动提取只读取文字，不判断能力。核对身份后才建立应聘。来源：{batch.source}
            </AlertDescription>
          </Alert>
          {files.some((f) => !f.done) && (
            <div className="flex flex-col gap-3">
              {files
                .filter((f) => !f.done)
                .map((f) => (
                  <div key={f.key}>
                    <strong>{f.file.name}</strong>
                    <p>{f.error || '等待上传'}</p>
                  </div>
                ))}
              <Button disabled={busy} onClick={() => void sendFiles()}>
                {busy ? '正在处理…' : '重试未接收文件'}
              </Button>
            </div>
          )}
          {batch.received < batch.total && files.length === 0 && (
            <>
              <p>尚有文件未接收，可重新选择补齐。</p>
              <FileChoice disabled={busy} limit={batch.total - batch.received} select={setFiles} />
              <Button disabled={busy || !files.length} onClick={() => void sendFiles()}>
                上传选中文件
              </Button>
            </>
          )}
          <ul className="flex flex-col gap-3">
            {batch.items.map((item) => (
              <li key={item.id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <strong className="break-all">{item.name}</strong>
                  <Badge variant="secondary">
                    {item.application
                      ? '已关联应聘'
                      : item.parse?.status === 'succeeded'
                        ? '待核对身份'
                        : item.parse
                          ? '提取失败'
                          : '文件已停止访问'}
                  </Badge>
                </div>
                {item.parse?.error && <p className="mt-2 text-destructive">{item.parse.error}</p>}
                <Button
                  variant="outline"
                  className="mt-3"
                  disabled={busy || dirty || !item.parse}
                  onClick={() => {
                    if (item.application) openApplication(item.application);
                    else {
                      setActive(item);
                      setReload((r) => r + 1);
                    }
                  }}
                >
                  {item.application ? '打开本次应聘' : '核对与继续'}
                </Button>
              </li>
            ))}
          </ul>
          {active && (
            <IdentityEditor
              key={`${active.id}-${reload}`}
              batch={batch}
              item={active}
              busy={busy}
              setBusy={setBusy}
              setDirty={setDirty}
              saved={async (item) => {
                setActive(item.application ? null : item);
                setReload((r) => r + 1);
                await refresh(batch.id);
              }}
            />
          )}
        </>
      )}
    </Drawer>
  );
}
function FileChoice({
  select,
  disabled,
  limit = 20,
}: {
  select: (files: { file: File; key: string; error: string; done: boolean }[]) => void;
  disabled: boolean;
  limit?: number;
}) {
  const [error, setError] = useState('');
  return (
    <Field>
      <FieldLabel htmlFor="resume-files">简历文件</FieldLabel>
      <Input
        id="resume-files"
        type="file"
        accept=".pdf,.docx"
        multiple
        disabled={disabled}
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          if (files.length > limit || files.some((f) => f.size > 20 * 1024 * 1024 || !f.size)) {
            setError(`每批最多 ${limit} 份，每份须非空且不超过 20MB。`);
            select([]);
            return;
          }
          setError('');
          select(files.map((file) => ({ file, key: crypto.randomUUID(), error: '', done: false })));
        }}
      />
      <p className="text-muted-foreground">
        PDF / DOCX，每份不超过 20MB；文件逐份处理，失败可单独重试。
      </p>
      {error && <ErrorNotice message={error} />}
    </Field>
  );
}

function IdentityEditor({
  batch,
  item: initialItem,
  busy,
  setBusy,
  setDirty,
  saved,
}: {
  batch: Batch;
  item: ImportItem;
  busy: boolean;
  setBusy: (b: boolean) => void;
  setDirty: (b: boolean) => void;
  saved: (item: ImportItem) => Promise<void>;
}) {
  const [item, setItem] = useState(initialItem);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [contact, setContact] = useState('');
  const [note, setNote] = useState('');
  const [candidate, setCandidate] = useState('');
  const [matches, setMatches] = useState<Candidate[] | null>(null);
  const [error, setError] = useState('');
  const [manual, setManual] = useState('');
  const [parseKey, setParseKey] = useState(() => crypto.randomUUID());
  const path = `imports/${batch.id}/items/${item.id}/`;
  const payload = {
    parse: item.parse?.id,
    display_name: name,
    phone,
    email,
    contact_note: contact,
    candidate: candidate ? Number(candidate) : null,
    identity_note: note,
  };
  async function parse(text?: string) {
    setBusy(true);
    setError('');
    try {
      const r = await api<ImportItem>(`${path}parse/`, {
        request_key: parseKey,
        ...(text ? { text } : {}),
      });
      await saved(r);
      setDirty(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="flex flex-col gap-4 rounded-lg border p-4">
      <h3>核对：{item.name}</h3>
      {error && (
        <ErrorNotice
          message={error}
          retry={async () => {
            if (busy) return;
            setBusy(true);
            try {
              const fresh = await api<Batch>(`imports/${batch.id}/`);
              const updated = fresh.items.find((i) => i.id === item.id);
              if (updated) setItem(updated);
              setError('');
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
      {item.parse?.status === 'succeeded' ? (
        <>
          <p>
            文字版本 v{item.parse.version} ·{' '}
            {item.parse.parser_version === '人工摘录' ? '人工摘录' : '原件文字提取'} ·{' '}
            {item.parse.actor_name}
          </p>
          <pre className="resume-text">{item.parse.text}</pre>
          <p className="text-muted-foreground">原文中的经历与能力是材料声明，尚未核实。</p>
        </>
      ) : (
        <>
          <p>{item.parse?.error}</p>
          <Button variant="outline" disabled={busy} onClick={() => void parse()}>
            重试文字提取
          </Button>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void parse(manual);
            }}
            className="flex flex-col gap-3"
          >
            <Field>
              <FieldLabel htmlFor="manual-resume">人工摘录（请写明页码或来源）</FieldLabel>
              <Textarea
                id="manual-resume"
                value={manual}
                onChange={(e) => {
                  setManual(e.target.value);
                  setDirty(true);
                  setParseKey(crypto.randomUUID());
                }}
                required
                maxLength={100000}
                disabled={busy}
              />
            </Field>
            <Button type="submit" disabled={busy}>
              保存人工摘录版本
            </Button>
          </form>
        </>
      )}
      {item.parse?.status === 'succeeded' && (
        <form
          className="flex flex-col gap-4"
          onChange={() => setDirty(true)}
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              if (matches === null) {
                const r = await api<{ results: Candidate[] }>(`${path}matches/`, payload);
                setMatches(r.results);
              } else {
                const r = await api<ImportItem>(`${path}confirm/`, payload);
                await saved(r);
                setDirty(false);
              }
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <fieldset disabled={busy} className="flex flex-col gap-4">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="candidate-name">姓名（人工核对）</FieldLabel>
                <Input
                  id="candidate-name"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setMatches(null);
                    setCandidate('');
                  }}
                  required
                  maxLength={100}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="candidate-phone">联系电话</FieldLabel>
                <Input
                  id="candidate-phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    setMatches(null);
                    setCandidate('');
                  }}
                  maxLength={32}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="candidate-email">邮箱</FieldLabel>
                <Input
                  id="candidate-email"
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setMatches(null);
                    setCandidate('');
                  }}
                  maxLength={254}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="contact-note">联系方式缺失说明</FieldLabel>
                <Input
                  id="contact-note"
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  required={!phone && !email && !candidate}
                  maxLength={500}
                />
              </Field>
              {matches !== null && (
                <>
                  <Alert>
                    <AlertTitle>
                      {matches.length
                        ? `发现 ${matches.length} 个疑似主档，请人工核对`
                        : '授权范围内暂未找到疑似重复'}
                    </AlertTitle>
                    <AlertDescription>
                      同名不自动合并；已有主档只会关联本次应聘，不修改主档联系方式。
                    </AlertDescription>
                  </Alert>
                  <Field>
                    <FieldLabel htmlFor="identity-choice">身份核对结果</FieldLabel>
                    <NativeSelect
                      id="identity-choice"
                      value={candidate}
                      onChange={(e) => setCandidate(e.target.value)}
                    >
                      <NativeSelectOption value="">建立独立人才主档</NativeSelectOption>
                      {matches.map((c) => (
                        <NativeSelectOption key={c.id} value={c.id}>
                          {c.display_name} · {c.phone || c.email || c.contact_note} · 档案 {c.id}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Field>
                  {matches.map((c) => (
                    <p key={c.id} className="text-muted-foreground">
                      档案 {c.id}：
                      {c.applications
                        .map((a) => `${a.job__title} 第${a.attempt_no}次 ${stages[a.stage]}`)
                        .join('；')}
                    </p>
                  ))}
                  <Field>
                    <FieldLabel htmlFor="identity-note">核对依据 / 同名区分依据</FieldLabel>
                    <Textarea
                      id="identity-note"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      required={!!matches.length || !!candidate}
                      maxLength={1000}
                    />
                  </Field>
                </>
              )}
            </FieldGroup>
            <Button type="submit" disabled={busy}>
              {busy ? '正在保存…' : matches === null ? '查找疑似重复' : '确认身份并进入应聘'}
            </Button>
          </fieldset>
        </form>
      )}
    </section>
  );
}

export function ApplicationDetail({
  id,
  close,
  changed,
}: {
  id: number;
  close: () => void;
  changed: () => void;
}) {
  const [data, setData] = useState<Application | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [reload, setReload] = useState(0);
  const [action, setAction] = useState('advance');
  const [reason, setReason] = useState('');
  const [handler, setHandler] = useState('');
  const [due, setDue] = useState('');
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [success, setSuccess] = useState('');
  useEffect(() => {
    const c = new AbortController();
    setError('');
    api<Application>(`applications/${id}/`, undefined, c.signal)
      .then((d) => {
        setData(d);
        if (d.stage === 'ready_to_schedule' || d.job_status !== 'open') setAction('withdraw');
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message);
      });
    return () => c.abort();
  }, [id, reload]);
  return (
    <Drawer
      title={data ? `${data.name} · 第 ${data.attempt_no} 次应聘` : '应聘详情'}
      close={close}
      busy={busy}
      dirty={dirty}
    >
      {error && <ErrorNotice message={error} retry={() => setReload((r) => r + 1)} />}
      {success && (
        <Alert>
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      )}
      {!data ? (
        <Loading />
      ) : (
        <>
          <div>
            <h3>{data.job_title}</h3>
            <Badge variant="secondary">{stages[data.stage]}</Badge>
            <p>
              来源：{data.source} · HR：{data.owner_name}
            </p>
            <p>{data.phone || data.email || data.contact_note}</p>
          </div>
          <Alert>
            <AlertTitle>AI 评估尚未接通</AlertTitle>
            <AlertDescription>
              当前可依据实际材料人工复核。材料缺失可交给 HR
              补充；通过后只生成待安排任务，尚未发送邀请。
            </AlertDescription>
          </Alert>
          <section className="flex flex-col gap-3">
            <h3>当前正式招人要求</h3>
            {data.requirements.map((r) => (
              <p key={r.id}>
                {kindLabel[r.kind]}：{r.text}
                {r.rationale && `（${r.rationale}）`}
              </p>
            ))}
          </section>
          <section className="flex flex-col gap-3">
            <h3>本次应聘的材料</h3>
            {!data.resumes.length && (
              <p>尚无材料。可从导入简历补充并选用此人才主档，或记录需要补充的内容。</p>
            )}
            {data.resumes.map((r) => (
              <details key={r.document} className="rounded-lg border p-3">
                <summary className="cursor-pointer break-all">
                  {r.name} ·{' '}
                  {r.parse
                    ? `文字版本 v${r.parse.version} · ${r.parse.parser_version === '人工摘录' ? '人工摘录' : '原件文字提取'}`
                    : '已停止访问'}
                </summary>
                {r.parse && (
                  <>
                    <pre className="resume-text">{r.parse.text}</pre>
                    {r.download && (
                      <a
                        href={`/api/v1/documents/${r.document}/download/`}
                        className="text-primary underline"
                      >
                        下载原件（重新校验权限）
                      </a>
                    )}
                  </>
                )}
              </details>
            ))}
          </section>
          {data.stage !== 'closed' && (
            <form
              className="flex flex-col gap-4"
              onChange={() => {
                setDirty(true);
                setKey(crypto.randomUUID());
                setSuccess('');
              }}
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError('');
                try {
                  const next = await api<Application>(`applications/${id}/review/`, {
                    version: data.version,
                    profile: data.profile,
                    request_key: key,
                    action,
                    reason,
                    followup_owner: action === 'need_info' ? Number(handler) : null,
                    due_at: action === 'need_info' ? new Date(due).toISOString() : null,
                  });
                  setData(next);
                  setAction(next.stage === 'ready_to_schedule' ? 'withdraw' : 'advance');
                  setReason('');
                  setDirty(false);
                  setKey(crypto.randomUUID());
                  setSuccess('处理结果已保存，相关待办已更新。');
                  changed();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <h3>人工复核</h3>
              <fieldset disabled={busy} className="flex flex-col gap-4">
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="review-action">处理结果</FieldLabel>
                    <NativeSelect
                      id="review-action"
                      value={action}
                      required
                      onChange={(e) => setAction(e.target.value)}
                    >
                      <NativeSelectOption value="" disabled>
                        请选择处理结果
                      </NativeSelectOption>
                      {Object.entries(reviewActions)
                        .filter(([v]) => v !== 'supplement' || data.stage === 'needs_information')
                        .filter(
                          ([v]) =>
                            (data.stage !== 'ready_to_schedule' && data.job_status === 'open') ||
                            v === 'withdraw',
                        )
                        .map(([v, l]) => (
                          <NativeSelectOption key={v} value={v}>
                            {l}
                          </NativeSelectOption>
                        ))}
                    </NativeSelect>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="review-reason">依据与说明</FieldLabel>
                    <Textarea
                      id="review-reason"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      required
                      maxLength={2000}
                      placeholder="写明材料页码、核对结果及待确认之处；待补充请列明缺少的内容。"
                    />
                  </Field>
                  {action === 'need_info' && (
                    <>
                      <Field>
                        <FieldLabel htmlFor="followup-owner">接手 HR</FieldLabel>
                        <NativeSelect
                          id="followup-owner"
                          value={handler}
                          onChange={(e) => setHandler(e.target.value)}
                          required
                        >
                          <NativeSelectOption value="">请选择本岗 HR</NativeSelectOption>
                          {data.handlers.map((h) => (
                            <NativeSelectOption key={h.id} value={h.id}>
                              {h.name}
                            </NativeSelectOption>
                          ))}
                        </NativeSelect>
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="followup-due">跟进期限（本机时区）</FieldLabel>
                        <Input
                          id="followup-due"
                          type="datetime-local"
                          value={due}
                          onChange={(e) => setDue(e.target.value)}
                          required
                        />
                      </Field>
                    </>
                  )}
                </FieldGroup>
                <Button type="submit" disabled={busy}>
                  {busy ? '正在保存…' : '提交人工处理结果'}
                </Button>
              </fieldset>
            </form>
          )}
          {data.job_status !== 'open' && data.stage !== 'closed' && (
            <Alert>
              <AlertDescription>
                职位当前暂停或未招聘，恢复后再继续复核；已有内容继续保留。
              </AlertDescription>
            </Alert>
          )}
          {data.stage === 'ready_to_schedule' && (
            <ScheduleInterview
              application={data}
              dirty={dirty}
              setDirty={setDirty}
              scheduled={() => {
                setSuccess('排期已保存，候选人与面试官的系统内时间冲突已检查。邀请尚未发送。');
                setDirty(false);
                setReload((old) => old + 1);
              }}
            />
          )}
          {data.stage === 'closed' && <p>本次结束原因：{data.close_reason}</p>}
          <section className="flex flex-col gap-3">
            <h3>人工处理记录</h3>
            {data.reviews.length === 0 ? (
              <p>尚未提交人工处理结果。</p>
            ) : (
              data.reviews.map((r) => (
                <article key={r.id} className="rounded-lg border p-4">
                  <strong>
                    {reviewActions[r.action]} · {r.reviewer_name}
                  </strong>
                  <p className="whitespace-pre-wrap">{r.reason}</p>
                  {r.followup_owner && (
                    <p>
                      接手：{r.followup_owner} · 截止 {r.due_at && dateTime(r.due_at)}
                    </p>
                  )}
                  <small>
                    {dateTime(r.created_at)} · {stages[r.result_stage]} · 固定{' '}
                    {r.input_parses.length} 份材料版本
                  </small>
                </article>
              ))
            )}
          </section>
        </>
      )}
    </Drawer>
  );
}
