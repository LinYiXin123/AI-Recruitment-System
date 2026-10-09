import Modal from '@douyinfe/semi-ui/lib/es/modal';
import Select from '@douyinfe/semi-ui/lib/es/select';
import Table from '@douyinfe/semi-ui/lib/es/table';
import {
  ArrowLeft,
  BriefcaseBusiness,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  FileText,
} from 'lucide-react';
import {
  forwardRef,
  type ReactNode,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
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
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, api, dateTime, type Job, kindLabel, type Page } from '@/lib/api';
import {
  type Application,
  type Batch,
  type Candidate,
  type ImportItem,
  identifyResume,
  resumeFormFields,
  reviewActions,
  stages,
  stageVariants,
} from '@/lib/intake';
import { ApplicationProfile } from '@/pages/application-profile';
import { ScheduleInterview } from '@/pages/interviews';
import './candidate-detail.css';

function Drawer({
  title,
  close,
  busy,
  dirty,
  leaveMessage = '还有未保存的内容，确定离开吗？',
  children,
}: {
  title: string;
  close: () => void;
  busy: boolean;
  dirty: boolean;
  leaveMessage?: string;
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
        if (!open && !busy && (!dirty || window.confirm(leaveMessage))) close();
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
        <FieldLabel id="target-job-label" htmlFor="target-job">
          目标职位
        </FieldLabel>
        <NativeSelect
          aria-labelledby="target-job-label"
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

export function ProfileCandidatePicker({
  initialJob,
  close,
  openApplication,
  importResume,
}: {
  initialJob: Pick<Job, 'id' | 'title'> | null;
  close: () => void;
  openApplication: (id: number) => void;
  importResume: (job: Job) => void;
}) {
  const [job, setJob] = useState(String(initialJob?.id ?? ''));
  const [jobDetails, setJobDetails] = useState<Job | null>(null);
  const [jobError, setJobError] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<Candidate> | null>(null);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [source, setSource] = useState('');
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setJobDetails(null);
    setSelected(null);
    setJobError('');
    if (job)
      api<Job>(`jobs/${job}/`, undefined, controller.signal)
        .then(setJobDetails)
        .catch((e) => {
          if (e.name !== 'AbortError') setJobError(e.message);
        });
    return () => controller.abort();
  }, [job, reload]);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setSelected(null);
    setError('');
    api<Page<Candidate>>(
      `candidates/?${new URLSearchParams({ search, page: String(page) })}`,
      undefined,
      controller.signal,
    )
      .then(setData)
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message);
      });
    return () => controller.abort();
  }, [search, page, reload]);
  const canJoin =
    jobDetails?.permissions.edit && jobDetails.status === 'open' && jobDetails.active_profile;
  const existing = selected?.applications.find(
    (a) => a.job_id === Number(job) && a.stage !== 'closed',
  );
  return (
    <Drawer title="选择候选人" close={close} busy={busy} dirty={!!source.trim()}>
      <p>先选职位，再选已有档案。同一职位已有进行中的应聘会直接打开。</p>
      <p className="text-sm text-muted-foreground">
        这里处理本系统的候选人。正在飞书推进的应聘，请继续在飞书处理。
      </p>
      {initialJob ? (
        <p>
          目标职位：<strong>{initialJob.title}</strong>
        </p>
      ) : (
        <JobPicker
          value={job}
          onChange={(value) => {
            setJob(value);
            setKey(crypto.randomUUID());
          }}
          disabled={busy}
        />
      )}
      {(jobError || error) && (
        <ErrorNotice
          message={jobError || error}
          retry={busy ? undefined : () => setReload((value) => value + 1)}
        />
      )}
      {jobDetails && !canJoin && (
        <Alert>
          <AlertDescription>
            此职位需要操作权限、已启用的招人要求和招聘中状态，才能加入候选人。
          </AlertDescription>
        </Alert>
      )}
      <Field>
        <FieldLabel htmlFor="profile-person-search">搜索已有候选人</FieldLabel>
        <Input
          id="profile-person-search"
          placeholder="输入姓名、电话或邮箱"
          value={search}
          disabled={busy}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </Field>
      {!data ? (
        !error && <Loading />
      ) : !data.count ? (
        <Empty className="flex-none py-8">
          <EmptyHeader>
            <EmptyTitle>没有找到已有候选人</EmptyTitle>
            <EmptyDescription>
              可以换个关键词；确实是新候选人时，再导入简历并核对身份。
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {data.results.map((person) => (
              <li
                key={person.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
              >
                <div>
                  <strong>{person.display_name}</strong>
                  <p className="text-sm text-muted-foreground">
                    {person.phone || person.email || person.contact_note}
                  </p>
                </div>
                <Button
                  variant={selected?.id === person.id ? 'secondary' : 'outline'}
                  disabled={busy}
                  onClick={() => {
                    setSelected(person);
                    setKey(crypto.randomUUID());
                    setError('');
                  }}
                >
                  {' '}
                  {selected?.id === person.id ? '已选择' : '选择此人'}{' '}
                </Button>
              </li>
            ))}
          </ul>
          <fieldset disabled={busy}>
            <Pager page={page} count={data.count} onChange={setPage} />
          </fieldset>
        </>
      )}
      {selected &&
        (existing ? (
          <>
            <p>
              此人已应聘“{jobDetails?.title ?? initialJob?.title}”，将打开第 {existing.attempt_no}{' '}
              次应聘，不新增记录。
            </p>
            <Button disabled={busy || !jobDetails} onClick={() => openApplication(existing.id)}>
              打开已有应聘
            </Button>
          </>
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy || !canJoin || !selected) return;
              setBusy(true);
              setError('');
              try {
                const result = await api<{ application: number }>(
                  `candidates/${selected.id}/apply/`,
                  { request_key: key, job: Number(job), source },
                );
                openApplication(result.application);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <p>
              将为“{selected.display_name}
              ”加入这个职位。其他职位的记录保持原样；接下来补充本次简历再分析。
            </p>
            <Field>
              <FieldLabel htmlFor="profile-person-source">材料来源</FieldLabel>
              <Input
                id="profile-person-source"
                value={source}
                maxLength={200}
                required
                disabled={busy}
                placeholder="例如：本人投递、经本人同意转交"
                onChange={(e) => {
                  setSource(e.target.value);
                  setKey(crypto.randomUUID());
                }}
              />
            </Field>
            <Button type="submit" disabled={busy || !canJoin || !source.trim()}>
              {busy ? '正在加入…' : '加入职位并继续'}
            </Button>
          </form>
        ))}
      {canJoin && jobDetails && (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            if (!source.trim() || window.confirm('切换后需重新填写材料来源，确定导入新简历吗？'))
              importResume(jobDetails);
          }}
        >
          导入新的简历
        </Button>
      )}
    </Drawer>
  );
}

type CandidateFilterOptions = {
  jobs: { job_id: number; job__title: string }[];
};

type CandidateApplication = Candidate['applications'][number] & {
  version: number;
  expected_start_date: string | null;
  offer_sent_at?: string | null;
  hired_at?: string | null;
  can_edit?: boolean;
};

type CandidateRecord = Omit<Candidate, 'applications'> & {
  applications: CandidateApplication[];
  current_city: string;
  education_level: string;
  school: string;
  work_years: string;
  expected_salary: string;
  source: string;
  gender: string;
  birthday: string;
  identity_number: string;
  intended_role: string;
  current_salary: string;
  work_experience: string;
  education_experience: string;
  remarks: string;
  resume_text: string;
  resume_documents: (Application['resumes'][number] & { is_current?: boolean })[];
  created_at: string;
  updated_at: string;
  can_edit_profile: boolean;
  can_delete: boolean;
  active_application_count: number;
  interview_count?: number;
  interview_records?: {
    id: number;
    application: number;
    job_title: string;
    round_no: number;
    purpose: string;
    status: string;
    organizer_name: string;
    revision: {
      starts_at: string;
      ends_at: string;
      mode: string;
      location: string;
      meeting_url: string;
    } | null;
  }[];
  ai_screening_count?: number;
  ai_screenings?: {
    id: number;
    application_id: number;
    job_title: string;
    code: string;
    created_at: string;
    summary: string;
    match_score: number | null;
    conclusion: string;
    question_count: number;
  }[];
};

function primaryCandidateApplication(person: CandidateRecord) {
  const applications = [...person.applications].sort((a, b) => b.id - a.id);
  return applications.find((item) => !item.closed_at) ?? applications[0];
}

export type CandidateLibraryActions = {
  exportModule: () => void;
  openCreateCandidate: () => void;
  showMailboxSyncStatus: () => void;
};

const emptyCandidateFilters: CandidateFilterOptions = { jobs: [] };
const candidateFilterStages = [
  'pending_review',
  'ready_to_schedule',
  'first_interview_passed',
  'second_interview',
  'second_interview_passed',
  'offer_sent',
  'hired',
  'closed',
  'talent_pool',
] as const;
const resumeSources = [
  'BOSS直聘',
  '智联招聘',
  '前程无忧',
  '猎聘',
  '拉勾',
  '内推',
  '猎头推荐',
  '校园招聘',
  '官网投递',
  '其他',
] as const;
const educationLevels = ['高中及以下', '大专', '本科', '硕士', '博士', '其他'] as const;
const profileFields = {
  current_city: '现居城市',
  education_level: '最高学历',
  school: '毕业院校',
  work_years: '工作年限',
  intended_role: '意向岗位',
  current_salary: '当前薪资',
  expected_salary: '期望薪资',
  source: '简历来源',
} as const;
type ProfileFields = Partial<Record<keyof typeof profileFields, string>>;

function ResumeProfileFields({
  values,
  change,
  disabled,
  prefix,
}: {
  values: ProfileFields;
  change: (key: keyof typeof profileFields, value: string) => void;
  disabled: boolean;
  prefix: string;
}) {
  return (
    <FieldGroup className="candidate-create-grid">
      {Object.entries(profileFields).map(([field, label]) => {
        const key = field as keyof typeof profileFields;
        const choices =
          key === 'source' ? resumeSources : key === 'education_level' ? educationLevels : null;
        return (
          <Field key={key}>
            <FieldLabel htmlFor={`${prefix}-${key}`}>{label}</FieldLabel>
            {choices ? (
              <Select
                id={`${prefix}-${key}`}
                aria-label={label}
                className="candidate-select"
                dropdownClassName="candidate-select-dropdown"
                value={values[key] || ''}
                onChange={(value) => change(key, typeof value === 'string' ? value : '')}
                disabled={disabled}
                placeholder="未标注，可手动选择"
                clickToHide
              >
                <Select.Option value="">未标注</Select.Option>
                {choices.map((item) => (
                  <Select.Option key={item} value={item}>
                    {item}
                  </Select.Option>
                ))}
                {values[key] && !(choices as readonly string[]).includes(values[key]) && (
                  <Select.Option value={values[key]}>{values[key]}</Select.Option>
                )}
              </Select>
            ) : (
              <Input
                id={`${prefix}-${key}`}
                value={values[key] || ''}
                onChange={(event) => change(key, event.target.value)}
                disabled={disabled}
                maxLength={
                  key === 'current_city'
                    ? 120
                    : key === 'work_years' || key.endsWith('salary')
                      ? 100
                      : 200
                }
                placeholder="未识别到，可手动补充"
              />
            )}
          </Field>
        );
      })}
    </FieldGroup>
  );
}

export const Candidates = forwardRef<
  CandidateLibraryActions,
  {
    revision: number;
    openApplication: (id: number) => void;
    changed: () => void;
    candidateId?: number | null;
    openCandidate?: (id: number) => void;
    backToCandidates?: () => void;
  }
>(function Candidates(
  { revision, openApplication, changed, candidateId = null, openCandidate, backToCandidates },
  ref,
) {
  const [search, setSearch] = useState('');
  const [stage, setStage] = useState('');
  const [job, setJob] = useState('');
  const [source, setSource] = useState('');
  const [educationLevel, setEducationLevel] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<CandidateRecord> | null>(null);
  const [filters, setFilters] = useState<CandidateFilterOptions>(emptyCandidateFilters);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<CandidateRecord | null>(null);
  const [exporting, setExporting] = useState(false);

  const query = new URLSearchParams({ page: String(page) });
  if (search) query.set('search', search);
  if (stage) query.set('stage', stage);
  if (job) query.set('job', job);
  if (source) query.set('source', source);
  if (educationLevel) query.set('education_level', educationLevel);
  const applicationUrl = `candidates/?${query.toString()}`;

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError('');
    api<Page<CandidateRecord>>(applicationUrl, undefined, controller.signal)
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
    setEducationLevel('');
    setPage(1);
  }

  async function exportModule() {
    if (exporting) return;
    setExporting(true);
    setNotice('');
    try {
      const exportQuery = new URLSearchParams(query);
      exportQuery.delete('page');
      const rows: CandidateRecord[] = [];
      let currentPage = 1;
      let total = 0;
      do {
        const response = await api<Page<CandidateRecord>>(
          `candidates/?${exportQuery.toString()}&page=${currentPage}`,
        );
        if (!response.results.length && rows.length < response.count)
          throw new Error('列表已变化，请重新导出。');
        total = response.count;
        rows.push(...response.results);
        currentPage += 1;
      } while (rows.length < total);
      const csv = [
        [
          '姓名',
          '应聘职位',
          '现居城市',
          '最高学历',
          '工作年限',
          '期望薪资',
          '简历来源',
          '当前状态',
        ],
        ...rows.map((item) => [
          item.display_name,
          item.applications.map((a) => a.job__title).join('、'),
          item.current_city,
          item.education_level,
          item.work_years,
          item.expected_salary,
          item.source,
          item.applications.map((a) => stages[a.stage]).join('、') || '待筛选',
        ]),
      ]
        .map((row) =>
          row
            .map((cell) => {
              const value = String(cell ?? '');
              return `"${(/^[\s]*[=+@-]/.test(value) ? `'${value}` : value).replaceAll('"', '""')}"`;
            })
            .join(','),
        )
        .join('\r\n');
      const url = URL.createObjectURL(
        new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = '候选人库.csv';
      link.click();
      URL.revokeObjectURL(url);
      setNotice(`已导出当前授权范围内的 ${rows.length} 位候选人。`);
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

  if (candidateId !== null) {
    return (
      <CandidateDetails
        key={candidateId}
        id={candidateId}
        revision={revision}
        changed={changed}
        close={
          backToCandidates ??
          (() => {
            window.location.hash = 'candidates';
          })
        }
        openApplication={openApplication}
      />
    );
  }

  function showCandidate(id: number) {
    if (openCandidate) openCandidate(id);
    else window.location.hash = `candidate/${id}`;
  }

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
          <Select
            className="candidate-filter-select"
            aria-label="筛选状态"
            value={stage}
            onChange={(value) => {
              setStage(typeof value === 'string' ? value : '');
              setPage(1);
            }}
            clickToHide
            dropdownClassName="candidate-select-dropdown"
          >
            <Select.Option value="">全部</Select.Option>
            {candidateFilterStages.map((value) => (
              <Select.Option key={value} value={value}>
                {stages[value]}
              </Select.Option>
            ))}
          </Select>
          <Select
            className="candidate-filter-select"
            aria-label="筛选来源"
            value={source}
            onChange={(value) => {
              setSource(typeof value === 'string' ? value : '');
              setPage(1);
            }}
            clickToHide
            dropdownClassName="candidate-select-dropdown"
          >
            <Select.Option value="">全部</Select.Option>
            {resumeSources.map((item) => (
              <Select.Option key={item} value={item}>
                {item}
              </Select.Option>
            ))}
          </Select>
          <Select
            className="candidate-filter-select"
            aria-label="筛选学历"
            value={educationLevel}
            onChange={(value) => {
              setEducationLevel(typeof value === 'string' ? value : '');
              setPage(1);
            }}
            clickToHide
            dropdownClassName="candidate-select-dropdown"
          >
            <Select.Option value="">全部</Select.Option>
            {educationLevels.map((item) => (
              <Select.Option key={item} value={item}>
                {item}
              </Select.Option>
            ))}
          </Select>
          <Select
            className="candidate-filter-select"
            aria-label="筛选职位"
            value={job}
            onChange={(value) => {
              setJob(typeof value === 'string' ? value : '');
              setPage(1);
            }}
            clickToHide
            dropdownClassName="candidate-select-dropdown"
          >
            <Select.Option value="">全部</Select.Option>
            {filters.jobs.map((item) => (
              <Select.Option key={item.job_id} value={String(item.job_id)}>
                {item.job__title}
              </Select.Option>
            ))}
          </Select>
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
              <EmptyTitle>
                {search || stage || job || source || educationLevel
                  ? '没有符合条件的候选人'
                  : '还没有数据'}
              </EmptyTitle>
              <EmptyDescription>
                {search || stage || job || source || educationLevel
                  ? '调整筛选条件，或点击「重置」查看全部。'
                  : '点击右上角「新增候选人」开始录入第一条'}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <div className="table-container">
              <Table<CandidateRecord>
                rowKey="id"
                dataSource={data.results}
                pagination={false}
                columns={[
                  {
                    title: '姓名',
                    width: 180,
                    render: (_, candidate) => (
                      <div className="flex flex-col items-start">
                        <Button variant="link" onClick={() => showCandidate(candidate.id)}>
                          {candidate.display_name}
                        </Button>
                        <span className="text-xs text-muted-foreground">
                          CAND-{String(candidate.id).padStart(4, '0')}
                        </span>
                      </div>
                    ),
                  },
                  {
                    title: '应聘职位',
                    width: 180,
                    render: (_, c) => c.applications.map((a) => a.job__title).join('、') || '—',
                  },
                  { title: '现居城市', width: 110, render: (_, c) => c.current_city || '—' },
                  { title: '最高学历', width: 100, render: (_, c) => c.education_level || '—' },
                  { title: '工作年限', width: 110, render: (_, c) => c.work_years || '—' },
                  { title: '期望薪资', width: 120, render: (_, c) => c.expected_salary || '—' },
                  { title: '简历来源', width: 120, render: (_, c) => c.source || '—' },
                  {
                    title: '当前状态',
                    width: 130,
                    render: (_, c) => (
                      <div className="flex flex-wrap gap-1">
                        {(c.applications.length
                          ? [...new Set(c.applications.map((a) => a.stage))]
                          : ['pending_review']
                        ).map((value) => (
                          <Badge variant={stageVariants[value] || 'muted'} key={value}>
                            {stages[value] || value}
                          </Badge>
                        ))}
                      </div>
                    ),
                  },
                  {
                    title: '操作',
                    width: 180,
                    render: (_, c) => (
                      <div className="flex items-center gap-1">
                        <Button variant="link" onClick={() => showCandidate(c.id)}>
                          详情
                        </Button>
                        {c.can_edit_profile && (
                          <Button variant="link" onClick={() => setEditingId(c.id)}>
                            编辑
                          </Button>
                        )}
                        {c.can_delete && (
                          <Button variant="destructive-link" onClick={() => setDeleting(c)}>
                            删除
                          </Button>
                        )}
                      </div>
                    ),
                  },
                ]}
              />
            </div>
            <Pager count={data.count} page={page} onChange={setPage} />
          </>
        )}
      </section>
      {deleting && (
        <DeleteCandidateDialog
          candidate={deleting}
          openApplication={(id) => {
            setDeleting(null);
            openApplication(id);
          }}
          close={() => {
            setDeleting(null);
            setReload((value) => value + 1);
          }}
          deleted={() => {
            setDeleting(null);
            if (data?.results.length === 1 && page > 1) setPage(page - 1);
            setNotice('候选人已删除。');
            changed();
          }}
        />
      )}
      {creating && (
        <CreateCandidateDialog
          close={() => setCreating(false)}
          saved={() => {
            setCreating(false);
            resetFilters();
            setNotice('候选人已保存。');
            changed();
          }}
        />
      )}
      {editingId !== null && (
        <EditCandidateLoader
          id={editingId}
          close={() => setEditingId(null)}
          saved={() => {
            setEditingId(null);
            setNotice('候选人已保存。');
            changed();
          }}
        />
      )}
    </>
  );
});

function DeleteCandidateDialog({
  candidate,
  close,
  deleted,
  openApplication,
}: {
  candidate: CandidateRecord;
  close: () => void;
  deleted: () => void;
  openApplication: (id: number) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const blocked = candidate.active_application_count > 0;

  async function remove() {
    if (submitting.current || blocked) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      await api(
        `candidates/${candidate.id}/`,
        { updated_at: candidate.updated_at },
        undefined,
        'DELETE',
      );
      deleted();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <Modal
      visible
      centered
      title="删除候选人"
      width={440}
      closable={!busy}
      maskClosable={!busy}
      closeOnEsc={!busy}
      onCancel={() => {
        if (!submitting.current) close();
      }}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={busy} onClick={close}>
            取消
          </Button>
          <Button variant="destructive" disabled={busy || blocked} onClick={() => void remove()}>
            {busy ? '正在删除…' : '确认删除'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {blocked ? (
          <>
            <p>
              「{candidate.display_name}」还有 {candidate.active_application_count} 条进行中的应聘，
              请先处理后再删除。
            </p>
            <ul className="flex flex-col gap-2">
              {candidate.applications
                .filter((application) => application.closed_at === null)
                .map((application) => (
                  <li key={application.id} className="flex items-center justify-between gap-3">
                    <span>
                      {application.job__title} · {stages[application.stage] || application.stage}
                    </span>
                    <Button variant="link" onClick={() => openApplication(application.id)}>
                      查看应聘
                    </Button>
                  </li>
                ))}
            </ul>
          </>
        ) : (
          <>
            <p>确定删除「{candidate.display_name}」吗？</p>
            <p className="text-sm text-muted-foreground">
              删除后将移出候选人库；已结束的应聘、面试和附件历史保留。
            </p>
          </>
        )}
        {error && <ErrorNotice message={error} />}
      </div>
    </Modal>
  );
}

function CandidateAttachment({
  document,
  showDescription = false,
}: {
  document: CandidateRecord['resume_documents'][number];
  showDescription?: boolean;
}) {
  return (
    <div className="candidate-attachment">
      <span className="candidate-attachment-name">
        <FileText aria-hidden="true" />
        <span>
          <strong>{document.name}</strong>
          {showDescription && <small>已关联本候选人，可在线查看或下载原件</small>}
        </span>
      </span>
      {document.download && (
        <div className="candidate-attachment-actions">
          <a
            href={`/api/v1/documents/${document.document}/download/?inline=1`}
            target="_blank"
            rel="noopener noreferrer"
          >
            查看
          </a>
          <a href={`/api/v1/documents/${document.document}/download/`} download={document.name}>
            下载
          </a>
        </div>
      )}
    </div>
  );
}

function EditCandidateLoader({
  id,
  close,
  saved,
}: {
  id: number;
  close: () => void;
  saved: () => void;
}) {
  const [person, setPerson] = useState<CandidateRecord | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    api<CandidateRecord>(`candidates/${id}/`, undefined, controller.signal)
      .then(setPerson)
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message);
      });
    return () => controller.abort();
  }, [id]);
  if (person?.can_edit_profile)
    return <CreateCandidateDialog person={person} close={close} saved={saved} />;
  return (
    <Modal
      visible
      centered
      title="编辑候选人"
      width={820}
      className="candidate-editor-modal"
      onCancel={close}
      footer={
        <Button variant="outline" onClick={close}>
          关闭
        </Button>
      }
    >
      {error ? (
        <ErrorNotice message={error} />
      ) : person ? (
        <ErrorNotice message="你暂时没有编辑该候选人的权限。" />
      ) : (
        <Loading />
      )}
    </Modal>
  );
}

function candidateDateTime(value: string) {
  return new Date(value)
    .toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    .replaceAll('/', '-');
}

function CandidateDetails({
  id,
  close,
  openApplication,
  changed,
  revision,
}: {
  id: number;
  close: () => void;
  openApplication: (id: number) => void;
  changed: () => void;
  revision: number;
}) {
  const [person, setPerson] = useState<CandidateRecord | null>(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [applicationId, setApplicationId] = useState<number | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    api<CandidateRecord>(`candidates/${id}/`, undefined, controller.signal)
      .then((result) => {
        setPerson(result);
        setApplicationId((current) =>
          result.applications.some((item) => item.id === current)
            ? current
            : (primaryCandidateApplication(result)?.id ?? null),
        );
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message);
      });
    return () => controller.abort();
  }, [id, reload, revision]);
  const application = person?.applications.find((item) => item.id === applicationId);
  const currentStage = application?.stage ?? 'pending_review';
  const interviews = person?.interview_records ?? [];
  const screenings = person?.ai_screenings ?? [];
  async function updateStage(value: string) {
    if (!person || !application || busy || value === application.stage) return;
    setBusy(true);
    setNotice('');
    try {
      await api(`candidates/${id}/edit/`, {
        request_key: crypto.randomUUID(),
        updated_at: person.updated_at,
        fields: {},
        application: {
          id: application.id,
          version: application.version,
          stage: value,
          expected_start_date: application.expected_start_date,
        },
      });
      setNotice('当前应聘状态已更新。');
      setReload((v) => v + 1);
      changed();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="candidate-detail-page" aria-label="候选人详情">
      <Button className="candidate-back" variant="link" onClick={close}>
        <ArrowLeft data-icon="inline-start" />
        返回候选人库
      </Button>
      <h1>候选人详情</h1>
      {error ? (
        <ErrorNotice message={error} retry={() => setReload((v) => v + 1)} />
      ) : !person ? (
        <Loading />
      ) : (
        <>
          {notice && (
            <Alert>
              <AlertTitle>候选人提示</AlertTitle>
              <AlertDescription>{notice}</AlertDescription>
            </Alert>
          )}
          <section className="candidate-detail-summary">
            <div className="candidate-detail-identity">
              <div className="candidate-detail-name">
                <h2>{person.display_name}</h2>
              </div>
              <div className="candidate-detail-meta">
                <Badge variant={stageVariants[currentStage] || 'muted'}>
                  {stages[currentStage] || currentStage}
                </Badge>
                {person.applications.length > 1 ? (
                  <div className="candidate-detail-application-picker">
                    <span id="candidate-detail-application-label" className="sr-only">
                      查看应聘记录
                    </span>
                    <Select
                      aria-labelledby="candidate-detail-application-label"
                      className="candidate-detail-application candidate-select"
                      value={applicationId}
                      onChange={(value) =>
                        setApplicationId(typeof value === 'number' ? value : null)
                      }
                      disabled={busy}
                      clickToHide
                      dropdownClassName="candidate-select-dropdown"
                    >
                      {person.applications.map((item) => (
                        <Select.Option value={item.id} key={item.id}>
                          {item.job__title} · 第 {item.attempt_no} 次应聘
                        </Select.Option>
                      ))}
                    </Select>
                  </div>
                ) : (
                  <p>{application?.job__title || '—'}</p>
                )}
              </div>
            </div>
            <div className="candidate-detail-actions">
              <span id="candidate-detail-stage-label" className="sr-only">
                修改当前状态
              </span>
              <Select
                aria-labelledby="candidate-detail-stage-label"
                className="candidate-detail-stage candidate-select"
                value={currentStage}
                disabled={
                  busy || !person.can_edit_profile || !application || application.can_edit === false
                }
                onChange={(value) => {
                  if (typeof value === 'string') void updateStage(value);
                }}
                clickToHide
                dropdownClassName="candidate-select-dropdown"
              >
                {Object.entries(stages).map(([value, label]) => (
                  <Select.Option key={value} value={value}>
                    {label}
                  </Select.Option>
                ))}
              </Select>
              <div className="candidate-detail-buttons">
                {person.can_edit_profile && (
                  <Button variant="outline" disabled={busy} onClick={() => setEditing(true)}>
                    编辑
                  </Button>
                )}
                {person.can_delete && (
                  <Button variant="destructive" disabled={busy} onClick={() => setDeleting(true)}>
                    删除
                  </Button>
                )}
              </div>
            </div>
          </section>
          <Tabs defaultValue="basic" className="candidate-detail-tabs">
            <TabsList variant="line" aria-label="候选人资料">
              <TabsTrigger value="basic">基本信息</TabsTrigger>
              <TabsTrigger value="interviews">
                面试记录（{person.interview_count ?? interviews.length}）
              </TabsTrigger>
              <TabsTrigger value="ai">
                AI 初面（{person.ai_screening_count ?? screenings.length}）
              </TabsTrigger>
              <TabsTrigger value="resume">简历原文</TabsTrigger>
            </TabsList>
            <TabsContent value="basic">
              <dl className="candidate-detail-fields">
                {[
                  ['候选人 ID', `CAND-${String(person.id).padStart(4, '0')}`],
                  ['应聘职位', application?.job__title],
                  ['意向岗位', person.intended_role],
                  ['联系方式', person.phone],
                  ['性别', person.gender],
                  ['邮箱', person.email],
                  ['现居城市', person.current_city],
                  ['身份证号', person.identity_number],
                  ['最高学历', person.education_level],
                  ['毕业院校', person.school],
                  ['工作年限', person.work_years],
                  ['当前薪资', person.current_salary],
                  ['期望薪资', person.expected_salary],
                  ['简历来源', person.source],
                  [
                    'Offer 发放时间',
                    application?.offer_sent_at ? candidateDateTime(application.offer_sent_at) : '',
                  ],
                  [
                    '入职时间',
                    application?.hired_at ? candidateDateTime(application.hired_at) : '',
                  ],
                  ['创建时间', person.created_at ? candidateDateTime(person.created_at) : ''],
                  ['更新时间', person.updated_at ? candidateDateTime(person.updated_at) : ''],
                  ['工作经历', person.work_experience],
                  ['教育经历', person.education_experience],
                  ['备注', person.remarks],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value || '—'}</dd>
                  </div>
                ))}
              </dl>
            </TabsContent>
            <TabsContent value="interviews">
              {interviews.length ? (
                <div className="candidate-records">
                  {interviews.map((item) => (
                    <article key={item.id} className="candidate-record">
                      <div className="candidate-record-heading">
                        <h3>
                          {item.job_title} · 第 {item.round_no} 轮面试
                        </h3>
                        <Badge variant="secondary">
                          {(
                            {
                              unscheduled: '未排期',
                              pending_confirmation: '待确认',
                              confirmed: '已确认',
                              completed: '已完成',
                              cancelled: '已取消',
                            } as Record<string, string>
                          )[item.status] || item.status}
                        </Badge>
                      </div>
                      <p>
                        {item.revision
                          ? `${candidateDateTime(item.revision.starts_at)} 至 ${candidateDateTime(item.revision.ends_at)}`
                          : '暂未排期'}
                      </p>
                      <p>
                        {item.revision?.location ||
                          (
                            { onsite: '现场面试', video: '视频面试', phone: '电话面试' } as Record<
                              string,
                              string
                            >
                          )[item.revision?.mode ?? ''] ||
                          '—'}{' '}
                        · 组织人：{item.organizer_name || '—'}
                      </p>
                      <Button variant="link" onClick={() => openApplication(item.application)}>
                        查看应聘
                      </Button>
                    </article>
                  ))}
                </div>
              ) : (
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>暂无面试记录</EmptyTitle>
                    <EmptyDescription>去「面试管理」为该候选人新增一条</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </TabsContent>
            <TabsContent value="ai">
              {screenings.length ? (
                <div className="candidate-records">
                  {screenings.map((item) => (
                    <article key={item.id} className="candidate-record">
                      <div className="candidate-record-heading">
                        <h3>{item.job_title || 'AI 初面报告'}</h3>
                        <span>{candidateDateTime(item.created_at)}</span>
                      </div>
                      <p>{item.summary || item.conclusion || '暂无分析摘要'}</p>
                      <p>
                        {item.match_score === null || item.match_score === undefined
                          ? ''
                          : `匹配度 ${item.match_score} · `}
                        {item.question_count} 道问题
                      </p>
                      <Button variant="link" onClick={() => openApplication(item.application_id)}>
                        查看应聘
                      </Button>
                    </article>
                  ))}
                </div>
              ) : (
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>暂无 AI 初面记录</EmptyTitle>
                    <EmptyDescription>去「AI 初面」对该候选人发起分析</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </TabsContent>
            <TabsContent value="resume">
              <div className="candidate-detail-resume">
                {person.resume_documents?.map((document) => (
                  <CandidateAttachment
                    key={document.document}
                    document={document}
                    showDescription
                  />
                ))}
                {person.resume_text ? (
                  <pre className="candidate-resume-text">{person.resume_text}</pre>
                ) : (
                  <Empty>
                    <EmptyHeader>
                      <EmptyTitle>暂无简历原文</EmptyTitle>
                    </EmptyHeader>
                  </Empty>
                )}
              </div>
            </TabsContent>
          </Tabs>
          {editing && (
            <CreateCandidateDialog
              person={person}
              initialApplicationId={applicationId}
              close={() => setEditing(false)}
              saved={(savedApplicationId) => {
                if (savedApplicationId !== undefined) setApplicationId(savedApplicationId);
                setEditing(false);
                setNotice('候选人已保存。');
                setReload((v) => v + 1);
                changed();
              }}
            />
          )}
          {deleting && (
            <DeleteCandidateDialog
              candidate={person}
              close={() => setDeleting(false)}
              openApplication={(value) => {
                setDeleting(false);
                openApplication(value);
              }}
              deleted={() => {
                changed();
                close();
              }}
            />
          )}
        </>
      )}
    </section>
  );
}

function CandidateDatePicker({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const selected = value ? new Date(`${value}T12:00:00`) : new Date();
    return new Date(selected.getFullYear(), selected.getMonth(), 1);
  });
  const monthLabel = `${visibleMonth.getFullYear()}年${visibleMonth.getMonth() + 1}月`;
  const firstDay = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1);
  const calendarStart = new Date(
    firstDay.getFullYear(),
    firstDay.getMonth(),
    1 - firstDay.getDay(),
  );
  const days = Array.from(
    { length: 42 },
    (_, index) =>
      new Date(
        calendarStart.getFullYear(),
        calendarStart.getMonth(),
        calendarStart.getDate() + index,
      ),
  );
  const today = new Date();
  const formatDate = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  return (
    <div className="candidate-date-picker" data-open={open}>
      <div className="candidate-date-control">
        <button
          type="button"
          id={id}
          className="candidate-date-trigger"
          aria-label="选择预计入职日期"
          aria-expanded={open}
          aria-controls="candidate-start-date-calendar"
          disabled={disabled}
          onClick={() => setOpen((current) => !current)}
        >
          <CalendarDays aria-hidden="true" />
          <span className={value ? '' : 'is-placeholder'}>{value || '选择预计入职日期'}</span>
        </button>
        {value && (
          <button
            type="button"
            className="candidate-date-clear"
            aria-label="清除预计入职日期"
            disabled={disabled}
            onClick={() => onChange('')}
          >
            清除
          </button>
        )}
      </div>
      {open && (
        <section
          className="candidate-calendar-panel"
          id="candidate-start-date-calendar"
          aria-label="日期日历"
        >
          <div className="candidate-calendar-header">
            <button
              type="button"
              aria-label="上个月"
              onClick={() =>
                setVisibleMonth(
                  new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1),
                )
              }
            >
              <ChevronLeft aria-hidden="true" />
            </button>
            <strong aria-live="polite">{monthLabel}</strong>
            <button
              type="button"
              aria-label="下个月"
              onClick={() =>
                setVisibleMonth(
                  new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1),
                )
              }
            >
              <ChevronRight aria-hidden="true" />
            </button>
          </div>
          <div className="candidate-calendar-grid">
            {['日', '一', '二', '三', '四', '五', '六'].map((weekday) => (
              <span className="candidate-calendar-weekday" aria-hidden="true" key={weekday}>
                {weekday}
              </span>
            ))}
            {days.map((day) => {
              const dateValue = formatDate(day);
              const inMonth = day.getMonth() === visibleMonth.getMonth();
              const isSelected = dateValue === value;
              const isToday = dateValue === formatDate(today);
              return (
                <button
                  type="button"
                  aria-label={dateValue}
                  aria-pressed={isSelected}
                  className={`candidate-calendar-day${inMonth ? '' : ' is-outside'}${isSelected ? ' is-selected' : ''}${isToday ? ' is-today' : ''}`}
                  key={dateValue}
                  onClick={() => {
                    onChange(dateValue);
                    setVisibleMonth(new Date(day.getFullYear(), day.getMonth(), 1));
                    setOpen(false);
                  }}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>
          <button
            className="candidate-calendar-today"
            type="button"
            onClick={() => {
              onChange(formatDate(today));
              setVisibleMonth(new Date(today.getFullYear(), today.getMonth(), 1));
              setOpen(false);
            }}
          >
            选择今天
          </button>
        </section>
      )}
    </div>
  );
}

function CreateCandidateDialog({
  close,
  saved,
  person,
  initialApplicationId,
}: {
  close: () => void;
  saved: (applicationId?: number) => void;
  person?: CandidateRecord;
  initialApplicationId?: number | null;
}) {
  const initialApplication =
    person?.applications.find((item) => item.id === initialApplicationId) ??
    (person ? primaryCandidateApplication(person) : undefined);
  const [selectedApplicationId, setSelectedApplicationId] = useState<number | null>(
    initialApplication?.id ?? null,
  );
  const selectedApplication = person?.applications.find(
    (item) => item.id === selectedApplicationId,
  );
  const existingAttachment =
    person?.resume_documents?.find((item) => item.is_current) ?? person?.resume_documents?.[0];
  const formId = person ? 'edit-candidate-form' : 'create-candidate-form';
  const [jobs, setJobs] = useState<Job[]>([]);
  const [name, setName] = useState(person?.display_name ?? '');
  const [phone, setPhone] = useState(person?.phone ?? '');
  const [email, setEmail] = useState(person?.email ?? '');
  const [gender, setGender] = useState(person?.gender ?? '');
  const [currentCity, setCurrentCity] = useState(person?.current_city ?? '');
  const [identityNumber, setIdentityNumber] = useState(person?.identity_number ?? '');
  const [birthday, setBirthday] = useState(person?.birthday ?? '');
  const [intendedRole, setIntendedRole] = useState(person?.intended_role ?? '');
  const [educationLevel, setEducationLevel] = useState(person?.education_level ?? '');
  const [school, setSchool] = useState(person?.school ?? '');
  const [workYears, setWorkYears] = useState(person?.work_years ?? '');
  const [currentSalary, setCurrentSalary] = useState(person?.current_salary ?? '');
  const [expectedSalary, setExpectedSalary] = useState(person?.expected_salary ?? '');
  const [stage, setStage] = useState(initialApplication?.stage ?? 'pending_review');
  const [expectedStartDate, setExpectedStartDate] = useState(
    initialApplication?.expected_start_date ?? '',
  );
  const [workExperience, setWorkExperience] = useState(person?.work_experience ?? '');
  const [educationExperience, setEducationExperience] = useState(
    person?.education_experience ?? '',
  );
  const [remarks, setRemarks] = useState(person?.remarks ?? '');
  const [resumeText, setResumeText] = useState(person?.resume_text ?? '');
  const [job, setJob] = useState(initialApplication ? String(initialApplication.job_id) : '');
  const [source, setSource] = useState(person?.source ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [draggingResume, setDraggingResume] = useState(false);
  const [attachment, setAttachment] = useState<Pick<
    ImportItem,
    'document' | 'name' | 'parse'
  > | null>(null);
  const [uploading, setUploading] = useState(false);
  const [contactNote, setContactNote] = useState(person?.contact_note || '待补充联系方式');
  const autofilled = useRef<Record<string, string>>({});
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const resumeInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function loadJobs() {
      const rows: Job[] = [];
      let page = 1;
      let response: Page<Job>;
      do {
        response = await api<Page<Job>>(
          `jobs/?status=open&page=${page}`,
          undefined,
          controller.signal,
        );
        rows.push(...response.results.filter((item) => item.permissions.edit));
        page += 1;
      } while (response.next);
      setJobs(rows);
    }
    loadJobs().catch((e) => {
      if (e.name !== 'AbortError') setError(e.message);
    });
    return () => controller.abort();
  }, []);

  async function importSelectedResume(list: FileList | File[]) {
    if (busy) return;
    const files = Array.from(list);
    if (files.length !== 1) {
      setError('请一次选择一份简历文件。');
      return;
    }
    if (!files[0].size || files[0].size > 10 * 1024 * 1024) {
      setError('单份简历须为非空文件，且不超过 10MB。');
      return;
    }
    setError('');
    setBusy(true);
    setUploading(true);
    try {
      const form = new FormData();
      form.append('request_key', crypto.randomUUID());
      form.append('file', files[0]);
      const result = await api<Pick<ImportItem, 'document' | 'name' | 'parse'>>(
        'candidates/preview-resume/',
        form,
      );
      setAttachment(result);
      if (result.parse?.status !== 'succeeded') {
        setError(`${result.parse?.error || '未读取到文字。'}原表单内容已保留，请核对后保存。`);
        return;
      }
      const fields = resumeFormFields(result.parse?.text ?? '', result.name);
      const setters: Record<string, (update: (value: string) => string) => void> = {
        display_name: setName,
        phone: setPhone,
        email: setEmail,
        gender: setGender,
        current_city: setCurrentCity,
        birthday: setBirthday,
        intended_role: setIntendedRole,
        education_level: setEducationLevel,
        school: setSchool,
        work_years: setWorkYears,
        current_salary: setCurrentSalary,
        expected_salary: setExpectedSalary,
        work_experience: setWorkExperience,
        education_experience: setEducationExperience,
        resume_text: setResumeText,
        source: setSource,
      };
      for (const [field, setValue] of Object.entries(setters)) {
        const value = fields[field as keyof typeof fields] ?? '';
        const previous = autofilled.current[field];
        setValue((current) =>
          field === 'resume_text' || current === previous || (!current && previous === undefined)
            ? value
            : current,
        );
      }
      autofilled.current = fields;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
      setBusy(false);
    }
  }

  return (
    <Modal
      visible
      centered
      width={820}
      title={person ? `编辑 · CAND-${String(person.id).padStart(4, '0')}` : '新增候选人'}
      className="candidate-create-modal candidate-editor-modal"
      maskClosable={!busy}
      closable={!busy}
      closeOnEsc={!busy}
      onCancel={() => {
        if (!busy) close();
      }}
      footer={
        <div className="candidate-create-footer">
          <Button type="button" variant="outline" disabled={busy} onClick={close}>
            取消
          </Button>
          <Button type="submit" form={formId} disabled={busy || !stage}>
            {uploading ? '正在识别…' : busy ? '正在保存…' : '保存'}
          </Button>
        </div>
      }
    >
      <form
        id={formId}
        className="candidate-create-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          setError('');
          try {
            const fields = {
              display_name: name,
              phone,
              email,
              contact_note: !phone.trim() && !email.trim() ? contactNote : '',
              gender,
              current_city: currentCity,
              identity_number: identityNumber,
              birthday,
              intended_role: intendedRole,
              education_level: educationLevel,
              school,
              work_years: workYears,
              current_salary: currentSalary,
              expected_salary: expectedSalary,
              work_experience: workExperience,
              education_experience: educationExperience,
              remarks,
              resume_text: resumeText,
              source,
            };
            const resume = attachment
              ? { resume_document: attachment.document, resume_parse: attachment.parse?.id }
              : {};
            if (person) {
              const updated = await api<CandidateRecord>(`candidates/${person.id}/edit/`, {
                request_key: requestKey,
                updated_at: person.updated_at,
                fields,
                ...resume,
                ...(selectedApplication?.can_edit === false
                  ? {}
                  : job
                    ? {
                        job: Number(job),
                        application: {
                          ...(selectedApplication
                            ? { id: selectedApplication.id, version: selectedApplication.version }
                            : {}),
                          stage,
                          expected_start_date: expectedStartDate || null,
                        },
                      }
                    : {}),
              });
              const savedApplication = selectedApplicationId
                ? updated.applications.find((item) => item.id === selectedApplicationId)
                : updated.applications.find(
                    (item) =>
                      item.job_id === Number(job) &&
                      !person.applications.some((previous) => previous.id === item.id),
                  );
              saved(savedApplication?.id);
            } else {
              await api('candidates/', {
                request_key: requestKey,
                ...fields,
                ...resume,
                job: job ? Number(job) : null,
                stage,
                expected_start_date: expectedStartDate || null,
              });
              saved();
            }
          } catch (e) {
            setError((e as Error).message);
            if (e instanceof ApiError && e.status >= 400 && e.status < 500)
              setRequestKey(crypto.randomUUID());
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field className="candidate-resume-field">
          <FieldLabel>简历文件</FieldLabel>
          {person && existingAttachment && !attachment ? (
            <div className="candidate-edit-attachment">
              <CandidateAttachment document={existingAttachment} />
              <Button
                type="button"
                variant="link"
                disabled={busy}
                onClick={() => resumeInput.current?.click()}
              >
                重新上传
              </Button>
            </div>
          ) : (
            <button
              type="button"
              className={`candidate-resume-choice${draggingResume ? ' is-dragging' : ''}`}
              disabled={busy}
              onClick={() => resumeInput.current?.click()}
              onDragOver={(event) => {
                event.preventDefault();
                setDraggingResume(true);
              }}
              onDragLeave={() => setDraggingResume(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDraggingResume(false);
                void importSelectedResume(event.dataTransfer.files);
              }}
            >
              <FileText aria-hidden="true" className="candidate-resume-icon" />
              <span>
                {uploading ? '正在识别简历…' : attachment ? attachment.name : '拖拽简历到此处，或'}{' '}
                {!uploading && <strong>{attachment ? '更换文件' : '点击选择文件'}</strong>}
              </span>
              <small>可识别：文字型 PDF / Word(.docx) / 纯文本</small>
              <small>图片与旧版 Word(.doc) 保存为附件，信息可手动填写</small>
              <small>单文件 ≤ 10MB</small>
            </button>
          )}
          <Input
            ref={resumeInput}
            className="candidate-resume-input"
            type="file"
            accept=".pdf,.doc,.docx,.txt,.jpg,.jpeg,.png"
            onChange={(event) => {
              if (event.target.files) void importSelectedResume(event.target.files);
              event.target.value = '';
            }}
            disabled={busy}
          />
        </Field>
        {error && <ErrorNotice message={error} />}
        {attachment && <p role="status">已选择：{attachment.name}，保存时一并归档。</p>}
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
            <FieldLabel id="new-candidate-gender-label" htmlFor="new-candidate-gender">
              性别
            </FieldLabel>
            <Select
              className="candidate-select"
              id="new-candidate-gender"
              aria-labelledby="new-candidate-gender-label"
              value={gender}
              onChange={(value) => setGender(typeof value === 'string' ? value : '')}
              placeholder="请选择性别"
              disabled={busy}
              clickToHide
              dropdownClassName="candidate-select-dropdown"
            >
              <Select.Option value="">未标注</Select.Option>
              <Select.Option value="男">男</Select.Option>
              <Select.Option value="女">女</Select.Option>
            </Select>
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
            <FieldLabel htmlFor="new-candidate-city">现居城市</FieldLabel>
            <Input
              id="new-candidate-city"
              value={currentCity}
              onChange={(event) => setCurrentCity(event.target.value)}
              maxLength={120}
              disabled={busy}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="new-candidate-identity-number">身份证号</FieldLabel>
            <Input
              id="new-candidate-identity-number"
              value={identityNumber}
              onChange={(event) => setIdentityNumber(event.target.value)}
              placeholder="18 位，选填"
              maxLength={18}
              disabled={busy}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="new-candidate-birthday">生日</FieldLabel>
            <Input
              id="new-candidate-birthday"
              value={birthday}
              onChange={(event) => setBirthday(event.target.value)}
              placeholder="如 09-28，或 1998-09-28（留空则按身份证号自动推算）"
              maxLength={10}
              disabled={busy}
            />
          </Field>
          <Field>
            <FieldLabel id="new-candidate-job-label" htmlFor="new-candidate-job">
              应聘职位
            </FieldLabel>
            <Select
              className="candidate-select"
              id="new-candidate-job"
              aria-labelledby="new-candidate-job-label"
              value={
                person
                  ? selectedApplicationId
                    ? `application:${selectedApplicationId}`
                    : job
                      ? `job:${job}`
                      : ''
                  : job
              }
              onChange={(value) => {
                const selected = typeof value === 'string' ? value : '';
                const chosenApplication = person?.applications.find(
                  (item) => selected === `application:${item.id}`,
                );
                setSelectedApplicationId(chosenApplication?.id ?? null);
                setJob(
                  chosenApplication
                    ? String(chosenApplication.job_id)
                    : selected.replace(/^job:/, ''),
                );
                setStage(chosenApplication?.stage ?? 'pending_review');
                setExpectedStartDate(chosenApplication?.expected_start_date ?? '');
              }}
              placeholder="暂不关联职位"
              disabled={busy}
              filter
              clickToHide
              dropdownClassName="candidate-select-dropdown"
            >
              <Select.Option value="">暂不关联职位</Select.Option>
              {person?.applications.map((item) => (
                <Select.Option key={`application:${item.id}`} value={`application:${item.id}`}>
                  {item.job__title} · 第 {item.attempt_no} 次应聘
                </Select.Option>
              ))}
              {jobs
                .filter(
                  (item) =>
                    !person?.applications.some(
                      (application) => !application.closed_at && application.job_id === item.id,
                    ),
                )
                .map((item) => (
                  <Select.Option key={item.id} value={person ? `job:${item.id}` : String(item.id)}>
                    {item.title} · {item.department_name}
                  </Select.Option>
                ))}
            </Select>
            {person && job && !selectedApplication && (
              <FieldDescription>将新增本职位应聘并保留原记录。</FieldDescription>
            )}
            {person && !job && person.applications.length > 0 && (
              <FieldDescription>仅编辑候选人资料，已有应聘记录保持不变。</FieldDescription>
            )}
          </Field>
          <Field>
            <FieldLabel htmlFor="new-candidate-intended-role">意向岗位（简历识别）</FieldLabel>
            <Input
              id="new-candidate-intended-role"
              value={intendedRole}
              onChange={(event) => setIntendedRole(event.target.value)}
              placeholder="如：前端工程师（来自简历识别，可改）"
              maxLength={200}
              disabled={busy}
            />
          </Field>
          <Field>
            <FieldLabel id="new-candidate-source-label" htmlFor="new-candidate-source">
              简历来源
            </FieldLabel>
            <Select
              className="candidate-select"
              id="new-candidate-source"
              aria-labelledby="new-candidate-source-label"
              value={source}
              onChange={(value) => setSource(typeof value === 'string' ? value : '')}
              placeholder="请选择简历来源"
              disabled={busy}
              clickToHide
              dropdownClassName="candidate-select-dropdown"
            >
              <Select.Option value="">未标注</Select.Option>
              {source && !(resumeSources as readonly string[]).includes(source) && (
                <Select.Option value={source}>{source}</Select.Option>
              )}
              {resumeSources.map((item) => (
                <Select.Option key={item} value={item}>
                  {item}
                </Select.Option>
              ))}
            </Select>
          </Field>
          <Field>
            <FieldLabel
              id="new-candidate-education-level-label"
              htmlFor="new-candidate-education-level"
            >
              最高学历
            </FieldLabel>
            <Select
              className="candidate-select"
              id="new-candidate-education-level"
              aria-labelledby="new-candidate-education-level-label"
              value={educationLevel}
              onChange={(value) => setEducationLevel(typeof value === 'string' ? value : '')}
              placeholder="请选择学历"
              disabled={busy}
              clickToHide
              dropdownClassName="candidate-select-dropdown"
            >
              <Select.Option value="">请选择</Select.Option>
              {educationLevel &&
                !(educationLevels as readonly string[]).includes(educationLevel) && (
                  <Select.Option value={educationLevel}>{educationLevel}</Select.Option>
                )}
              {educationLevels.map((item) => (
                <Select.Option key={item} value={item}>
                  {item}
                </Select.Option>
              ))}
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="new-candidate-school">毕业院校</FieldLabel>
            <Input
              id="new-candidate-school"
              value={school}
              onChange={(event) => setSchool(event.target.value)}
              maxLength={200}
              disabled={busy}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="new-candidate-work-years">工作年限</FieldLabel>
            <Input
              id="new-candidate-work-years"
              value={workYears}
              onChange={(event) => setWorkYears(event.target.value)}
              maxLength={100}
              disabled={busy}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="new-candidate-current-salary">当前薪资</FieldLabel>
            <Input
              id="new-candidate-current-salary"
              value={currentSalary}
              onChange={(event) => setCurrentSalary(event.target.value)}
              placeholder="如：9K / 8000-12000元（选填，文本）"
              maxLength={100}
              disabled={busy}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="new-candidate-expected-salary">期望薪资</FieldLabel>
            <Input
              id="new-candidate-expected-salary"
              value={expectedSalary}
              onChange={(event) => setExpectedSalary(event.target.value)}
              placeholder="如：9K / 8-10K（文本，不做数值化）"
              maxLength={100}
              disabled={busy}
            />
          </Field>
          <Field>
            <FieldLabel id="new-candidate-stage-label" htmlFor="new-candidate-stage">
              当前状态
            </FieldLabel>
            <Select
              className="candidate-select"
              id="new-candidate-stage"
              aria-labelledby="new-candidate-stage-label"
              value={stage}
              onChange={(value) => setStage(typeof value === 'string' ? value : '')}
              disabled={busy || !job || selectedApplication?.can_edit === false}
              clickToHide
              dropdownClassName="candidate-select-dropdown"
            >
              <Select.Option value="pending_review">待筛选</Select.Option>
              {person && <Select.Option value="needs_information">待补充资料</Select.Option>}
              {person && <Select.Option value="interviewing">面试中</Select.Option>}
              <Select.Option value="ready_to_schedule">待初试</Select.Option>
              <Select.Option value="first_interview_passed">初试通过</Select.Option>
              <Select.Option value="second_interview">待复试</Select.Option>
              <Select.Option value="second_interview_passed">复试通过</Select.Option>
              <Select.Option value="offer_sent">已发offer</Select.Option>
              <Select.Option value="hired">已入职</Select.Option>
              <Select.Option value="closed">已淘汰</Select.Option>
              <Select.Option value="talent_pool">人才库</Select.Option>
            </Select>
          </Field>
          {!phone.trim() && !email.trim() && (
            <Field className="candidate-create-full">
              <FieldLabel htmlFor="new-candidate-contact-note">联系方式待补充</FieldLabel>
              <Input
                id="new-candidate-contact-note"
                value={contactNote}
                onChange={(event) => setContactNote(event.target.value)}
                required
                disabled={busy}
                maxLength={500}
              />
            </Field>
          )}
          <Field>
            <FieldLabel htmlFor="new-candidate-expected-start">预计入职日期</FieldLabel>
            <CandidateDatePicker
              id="new-candidate-expected-start"
              value={expectedStartDate}
              onChange={setExpectedStartDate}
              disabled={busy || !job || selectedApplication?.can_edit === false}
            />
            <p className="candidate-field-help">
              选填。待入职阶段的预计日期；为空时「入职管理」列表显示「待定」
            </p>
          </Field>
          <Field className="candidate-create-full">
            <FieldLabel htmlFor="new-candidate-work-experience">工作经历</FieldLabel>
            <Textarea
              id="new-candidate-work-experience"
              rows={4}
              value={workExperience}
              onChange={(event) => setWorkExperience(event.target.value)}
              placeholder="如：2020.07-2023.06 武汉XX教育 英语教师；2023.07-至今 襄阳XX学校 初中英语教师（选填）"
              maxLength={4000}
              disabled={busy}
            />
          </Field>
          <Field className="candidate-create-full">
            <FieldLabel htmlFor="new-candidate-education-experience">教育经历</FieldLabel>
            <Textarea
              id="new-candidate-education-experience"
              rows={4}
              value={educationExperience}
              onChange={(event) => setEducationExperience(event.target.value)}
              placeholder="如：2016.09-2020.06 湖北XX大学 新闻学 本科；2021.09-2024.06 湖北XX大学 新闻学 硕士（选填）"
              maxLength={4000}
              disabled={busy}
            />
          </Field>
          <Field className="candidate-create-full">
            <FieldLabel htmlFor="new-candidate-remarks">备注</FieldLabel>
            <Textarea
              id="new-candidate-remarks"
              rows={4}
              value={remarks}
              onChange={(event) => setRemarks(event.target.value)}
              maxLength={4000}
              disabled={busy}
            />
          </Field>
          <Field className="candidate-create-full">
            <FieldLabel htmlFor="new-candidate-resume-text">简历原文</FieldLabel>
            <Textarea
              id="new-candidate-resume-text"
              rows={5}
              value={resumeText}
              onChange={(event) => setResumeText(event.target.value)}
              placeholder="可直接粘贴整段简历文本"
              maxLength={100000}
              disabled={busy}
            />
          </Field>
        </FieldGroup>
      </form>
    </Modal>
  );
}

export function ImportDrawer({
  id,
  initialFiles = [],
  close,
  changed,
  openApplication,
  initialJob,
  application,
}: {
  id: number | 'new';
  initialFiles?: File[];
  close: () => void;
  changed: () => void;
  openApplication: (id: number) => void;
  initialJob?: Pick<Job, 'id' | 'title'>;
  application?: Application;
}) {
  const [batch, setBatch] = useState<Batch | null>(null);
  const [job, setJob] = useState(String(application?.job ?? initialJob?.id ?? ''));
  const [source, setSource] = useState('');
  const [files, setFiles] = useState<{ file: File; key: string; error: string; done: boolean }[]>(
    () => initialFiles.map((file) => ({ file, key: crypto.randomUUID(), error: '', done: false })),
  );
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [active, setActive] = useState<ImportItem | null>(null);
  const hasPendingFiles = !!batch && batch.completed < batch.total;
  const pendingMessage =
    '还有简历尚未核对并关联应聘。现在离开，下次需要重新导入这些文件，确定离开吗？';
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
      setDirty(false);
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
      title={
        application
          ? `补充简历 · ${application.name}`
          : batch
            ? `简历导入 · ${batch.job_title}`
            : '导入简历'
      }
      close={close}
      busy={busy}
      dirty={dirty || hasPendingFiles}
      leaveMessage={hasPendingFiles ? pendingMessage : undefined}
    >
      {error && (
        <ErrorNotice
          message={error}
          retry={
            batch || id !== 'new'
              ? async () => {
                  if (busy) return;
                  setBusy(true);
                  try {
                    await refresh(batch?.id ?? (id as number));
                    setError('');
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }
              : undefined
          }
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
            <Field>
              <FieldLabel htmlFor="import-source">简历来源</FieldLabel>
              <Select
                id="import-source"
                aria-label="简历来源"
                className="candidate-select"
                dropdownClassName="candidate-select-dropdown"
                value={source}
                disabled={busy}
                placeholder="请选择来源，可在识别后核对"
                clickToHide
                onChange={(value) => {
                  setSource(typeof value === 'string' ? value : '');
                  setKey(crypto.randomUUID());
                }}
              >
                <Select.Option value="">未标注</Select.Option>
                {resumeSources.map((item) => (
                  <Select.Option key={item} value={item}>
                    {item}
                  </Select.Option>
                ))}
              </Select>
            </Field>
            {application || initialJob ? (
              <p>
                目标职位：{application?.job_title ?? initialJob?.title}
                {application && ` · ${application.name} · 第 ${application.attempt_no} 次应聘`}
              </p>
            ) : (
              <JobPicker
                value={job}
                onChange={(value) => {
                  setJob(value);
                  setKey(crypto.randomUUID());
                }}
                disabled={busy}
              />
            )}
            {application && (
              <p className="text-sm text-muted-foreground">
                上传后核对简历属于此人，再补入这次应聘。保留原材料，不新建候选人。
              </p>
            )}
            <FileChoice
              disabled={busy}
              select={(selected) => {
                setFiles(selected);
                setKey(crypto.randomUUID());
              }}
            />
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
                  <Badge
                    variant={
                      item.application
                        ? 'success'
                        : item.parse?.status === 'succeeded'
                          ? 'warning'
                          : item.parse
                            ? 'destructive'
                            : 'muted'
                    }
                  >
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
                    if (item.application) {
                      if (!hasPendingFiles || window.confirm(pendingMessage))
                        openApplication(item.application);
                    } else {
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
              application={application}
              busy={busy}
              setBusy={setBusy}
              setDirty={setDirty}
              saved={async (item) => {
                setBatch((current) => {
                  if (!current) return current;
                  const items = current.items.map((row) => (row.id === item.id ? item : row));
                  return {
                    ...current,
                    items,
                    completed: items.filter((row) => row.application).length,
                  };
                });
                setActive(item.application ? null : item);
                setReload((r) => r + 1);
                setDirty(false);
                try {
                  await refresh(batch.id);
                } catch (e) {
                  setError((e as Error).message);
                }
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
  application,
}: {
  batch: Batch;
  item: ImportItem;
  busy: boolean;
  setBusy: (b: boolean) => void;
  setDirty: (b: boolean) => void;
  saved: (item: ImportItem) => Promise<void>;
  application?: Application;
}) {
  const [item, setItem] = useState(initialItem);
  const identified = identifyResume(
    item.parse?.status === 'succeeded' ? item.parse.text : '',
    item.name,
  );
  const recognized = resumeFormFields(
    item.parse?.status === 'succeeded' ? item.parse.text : '',
    item.name,
  );
  const [enteredProfile, setEnteredProfile] = useState<ProfileFields>({});
  const profile = Object.fromEntries(
    Object.keys(profileFields).map((field) => {
      const key = field as keyof typeof profileFields;
      return [
        key,
        enteredProfile[key] ??
          ((key === 'source' && batch.source !== 'HR 上传' ? batch.source : '') ||
            recognized[key] ||
            ''),
      ];
    }),
  ) as ProfileFields;
  const [enteredName, setName] = useState<string>();
  const [enteredPhone, setPhone] = useState<string>();
  const [enteredEmail, setEmail] = useState<string>();
  const name =
    application?.name ?? enteredName ?? (identified.name.length === 1 ? identified.name[0] : '');
  const phone =
    application?.phone ??
    enteredPhone ??
    (identified.phone.length === 1 ? identified.phone[0] : '');
  const email =
    application?.email ??
    enteredEmail ??
    (identified.email.length === 1 ? identified.email[0] : '');
  const ambiguousName = !application && enteredName === undefined && identified.name.length > 1;
  const ambiguousPhone = !application && enteredPhone === undefined && identified.phone.length > 1;
  const ambiguousEmail = !application && enteredEmail === undefined && identified.email.length > 1;
  const [contact, setContact] = useState(application?.contact_note ?? '');
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
    candidate: application?.candidate ?? (candidate ? Number(candidate) : null),
    ...(application ? { application: application.id } : {}),
    identity_note: application || candidate || matches?.length ? note : '',
    ...(!application && !candidate ? profile : {}),
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
              if (updated) {
                if (updated.application) {
                  await saved(updated);
                  setDirty(false);
                } else {
                  setItem(updated);
                  if (updated.parse?.id !== item.parse?.id) {
                    setMatches(null);
                    setCandidate('');
                    setNote('');
                  }
                }
              }
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
              if (matches === null && !application) {
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
            {application && (
              <Alert>
                <AlertTitle>为 {application.name} 补充简历</AlertTitle>
                <AlertDescription>
                  请对照上方原文确认是同一个人，并填写核对依据。资料不属于此人时请关闭，不要继续保存。
                </AlertDescription>
              </Alert>
            )}
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="candidate-name">姓名</FieldLabel>
                <Input
                  id="candidate-name"
                  aria-describedby={ambiguousName ? 'candidate-name-hint' : undefined}
                  value={name}
                  readOnly={!!application}
                  onChange={(e) => {
                    setName(e.target.value);
                    setMatches(null);
                    setCandidate('');
                    setNote('');
                  }}
                  required
                  maxLength={100}
                />
                {ambiguousName && (
                  <FieldDescription id="candidate-name-hint">
                    识别到多个，请对照原文填写
                  </FieldDescription>
                )}
              </Field>
              <Field>
                <FieldLabel htmlFor="candidate-phone">联系电话</FieldLabel>
                <Input
                  id="candidate-phone"
                  aria-describedby={ambiguousPhone ? 'candidate-phone-hint' : undefined}
                  type="tel"
                  value={phone}
                  readOnly={!!application}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    setMatches(null);
                    setCandidate('');
                    setNote('');
                  }}
                  maxLength={32}
                />
                {ambiguousPhone && (
                  <FieldDescription id="candidate-phone-hint">
                    识别到多个，请对照原文填写
                  </FieldDescription>
                )}
              </Field>
              <Field>
                <FieldLabel htmlFor="candidate-email">邮箱</FieldLabel>
                <Input
                  id="candidate-email"
                  aria-describedby={ambiguousEmail ? 'candidate-email-hint' : undefined}
                  type="email"
                  value={email}
                  readOnly={!!application}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setMatches(null);
                    setCandidate('');
                    setNote('');
                  }}
                  maxLength={254}
                />
                {ambiguousEmail && (
                  <FieldDescription id="candidate-email-hint">
                    识别到多个，请对照原文填写
                  </FieldDescription>
                )}
              </Field>
              {!application && !candidate && !phone.trim() && !email.trim() && (
                <Field>
                  <FieldLabel htmlFor="contact-note">联系方式缺失说明</FieldLabel>
                  <Input
                    id="contact-note"
                    value={contact}
                    onChange={(e) => setContact(e.target.value)}
                    placeholder="例如：简历未提供，等待本人补充"
                    required
                    maxLength={500}
                  />
                </Field>
              )}
              {matches?.length === 0 && <p role="status">在可查看的候选人中未发现重复。</p>}
              {!application && !candidate && (
                <details>
                  <summary>简历资料（核对学历、城市、薪资和来源）</summary>
                  <ResumeProfileFields
                    values={profile}
                    prefix="import-profile"
                    disabled={busy}
                    change={(key, value) => {
                      setEnteredProfile((old) => ({ ...old, [key]: value }));
                      setDirty(true);
                    }}
                  />
                </details>
              )}
              {!!matches?.length && (
                <>
                  <Alert>
                    <AlertTitle>发现 {matches.length} 位相似候选人，请核对是否同一人</AlertTitle>
                    <AlertDescription>
                      选择已有候选人仅关联应聘，不修改其联系方式。
                    </AlertDescription>
                  </Alert>
                  <Field>
                    <FieldLabel id="identity-choice-label" htmlFor="identity-choice">
                      选择候选人
                    </FieldLabel>
                    <NativeSelect
                      aria-labelledby="identity-choice-label"
                      id="identity-choice"
                      disabled={busy}
                      value={candidate}
                      onChange={(e) => {
                        setCandidate(e.target.value);
                        setNote('');
                        setDirty(true);
                      }}
                    >
                      <NativeSelectOption value="">不是以上人选，新建候选人</NativeSelectOption>
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
                    <FieldLabel htmlFor="identity-note">判断依据</FieldLabel>
                    <Textarea
                      id="identity-note"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder={
                        candidate
                          ? '例如：电话相同，确认为同一人'
                          : '例如：姓名相同，但联系方式不同'
                      }
                      required
                      maxLength={1000}
                    />
                  </Field>
                </>
              )}
              {application && (
                <Field>
                  <FieldLabel htmlFor="supplement-identity-note">核对依据</FieldLabel>
                  <Textarea
                    id="supplement-identity-note"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="例如：简历姓名和联系电话与档案一致"
                    required
                    maxLength={1000}
                  />
                </Field>
              )}
            </FieldGroup>
            <Button type="submit" disabled={busy}>
              {busy
                ? '正在保存…'
                : application
                  ? '确认属于此人，补入本次应聘'
                  : matches === null
                    ? '查找疑似重复'
                    : candidate
                      ? '关联候选人并加入职位'
                      : '新建候选人并加入职位'}
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [analysisEditing, setAnalysisEditing] = useState(false);
  const [reload, setReload] = useState(0);
  const [action, setAction] = useState('advance');
  const [reason, setReason] = useState('');
  const [handler, setHandler] = useState('');
  const [due, setDue] = useState('');
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [success, setSuccess] = useState('');
  const [supplementing, setSupplementing] = useState(false);
  const restoring = useRef(false);
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    setError('');
    api<Application>(`applications/${id}/`, undefined, c.signal)
      .then((d) => {
        if (c.signal.aborted) return;
        setData(d);
        if (d.stage === 'ready_to_schedule' || d.job_status !== 'open') setAction('withdraw');
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message);
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [id, reload]);
  if (supplementing && data)
    return (
      <ImportDrawer
        id="new"
        application={data}
        changed={changed}
        close={() => {
          setSupplementing(false);
          setLoading(true);
          setReload((value) => value + 1);
        }}
        openApplication={() => {
          setSupplementing(false);
          setLoading(true);
          setReload((value) => value + 1);
        }}
      />
    );
  return (
    <Drawer
      title={data ? `${data.name} · 第 ${data.attempt_no} 次应聘` : '应聘详情'}
      close={close}
      busy={busy || analysisBusy}
      dirty={dirty || analysisEditing}
    >
      {error && (
        <ErrorNotice
          message={error}
          retry={
            busy || loading || analysisBusy || analysisEditing
              ? undefined
              : () => {
                  setLoading(true);
                  setReload((r) => r + 1);
                }
          }
        />
      )}
      {loading && data && <p role="status">正在刷新应聘资料，请稍候。</p>}
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
            <Badge variant={stageVariants[data.stage] || 'muted'}>
              {stages[data.stage] || data.stage}
            </Badge>
            <p>
              来源：{data.source} · HR：{data.owner_name}
            </p>
            <p>{data.phone || data.email || data.contact_note}</p>
          </div>
          {data.candidate_deleted_at && (
            <Alert>
              <AlertTitle className="text-destructive">已移出候选人库</AlertTitle>
              <AlertDescription className="flex flex-col gap-3">
                <p>
                  {data.closed_at === null
                    ? ['pending_review', 'needs_information', 'ready_to_schedule'].includes(
                        data.stage,
                      )
                      ? '原应聘仍在进行中。可恢复主档案继续招聘；如需结束本次应聘，请在下方「人工复核」填写处理结果和说明。'
                      : '原应聘仍在进行中。请先恢复主档案，再按当前阶段处理后续流程。'
                    : '这里保留的是已结束的应聘记录。恢复主档案后可在候选人库中继续使用，历史结果不变。'}
                </p>
                {data.can_restore_candidate ? (
                  <Button
                    variant="outline"
                    className="self-start"
                    disabled={loading || busy || dirty || analysisBusy || analysisEditing}
                    onClick={async () => {
                      if (restoring.current) return;
                      restoring.current = true;
                      setBusy(true);
                      setError('');
                      setSuccess('');
                      try {
                        await api(`candidates/${data.candidate}/restore/`, {
                          updated_at: data.candidate_updated_at,
                        });
                        setSuccess('已恢复到候选人库，原有应聘和材料保持不变。');
                        setLoading(true);
                        setReload((value) => value + 1);
                        changed();
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        restoring.current = false;
                        setBusy(false);
                      }
                    }}
                  >
                    {busy ? '正在恢复…' : '恢复到候选人库'}
                  </Button>
                ) : (
                  <p>恢复主档案需由有原始资料及全部关联职位权限的 HR 操作。</p>
                )}
              </AlertDescription>
            </Alert>
          )}
          {data.stage !== 'closed' && data.job_status === 'open' && (
            <section
              className="flex flex-col gap-3 rounded-lg border p-4"
              aria-label="准备本次简历"
            >
              <p>
                {data.resumes.some((r) => r.parse?.status === 'succeeded' && r.parse.text.trim())
                  ? '简历已准备好，可在下方开始对照。需要更新材料时，先补充简历。'
                  : '下一步：补充本次应聘的简历。上传并核对身份后，就能开始对照招人要求。'}
              </p>
              <Button
                className="self-start"
                variant={data.resumes.length ? 'outline' : 'default'}
                disabled={loading || busy || dirty || analysisBusy || analysisEditing}
                onClick={() => setSupplementing(true)}
              >
                补充简历
              </Button>
            </section>
          )}
          <ApplicationProfile
            application={data}
            disabled={loading || busy || dirty}
            onBusyChange={setAnalysisBusy}
            onEditingChange={setAnalysisEditing}
          />
          <details className="rounded-lg border p-3">
            <summary className="cursor-pointer">
              当前正式招人要求 · {data.requirements.length} 项
            </summary>
            {data.requirements.map((r) => (
              <p key={r.id} className="mt-3">
                {kindLabel[r.kind]}：{r.text}
                {r.needs_verification && <Badge variant="warning">岗位要求待确认</Badge>}
                {r.rationale && `（${r.rationale}）`}
              </p>
            ))}
          </details>
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
                if (loading || busy || analysisBusy || analysisEditing) return;
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
              <fieldset
                disabled={loading || busy || analysisBusy || analysisEditing}
                className="flex flex-col gap-4"
              >
                <FieldGroup>
                  <Field>
                    <FieldLabel id="review-action-label" htmlFor="review-action">
                      处理结果
                    </FieldLabel>
                    <NativeSelect
                      aria-labelledby="review-action-label"
                      id="review-action"
                      value={action}
                      disabled={loading || busy || analysisBusy || analysisEditing}
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
                        <FieldLabel id="followup-owner-label" htmlFor="followup-owner">
                          接手 HR
                        </FieldLabel>
                        <NativeSelect
                          aria-labelledby="followup-owner-label"
                          id="followup-owner"
                          value={handler}
                          disabled={loading || busy || analysisBusy || analysisEditing}
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
            <fieldset
              disabled={loading || busy || analysisBusy || analysisEditing}
              inert={loading || busy || analysisBusy || analysisEditing}
            >
              <ScheduleInterview
                application={data}
                dirty={dirty}
                setDirty={setDirty}
                scheduled={() => {
                  setSuccess('排期已保存，候选人与面试官的系统内时间冲突已检查。邀请尚未发送。');
                  setDirty(false);
                  setLoading(true);
                  setReload((old) => old + 1);
                }}
              />
            </fieldset>
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
