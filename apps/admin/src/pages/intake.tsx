import Modal from '@douyinfe/semi-ui/lib/es/modal';
import Select from '@douyinfe/semi-ui/lib/es/select';
import Table from '@douyinfe/semi-ui/lib/es/table';
import { BriefcaseBusiness, CalendarDays, ChevronLeft, ChevronRight, FileText } from 'lucide-react';
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
} from '@/lib/intake';
import { ApplicationProfile } from '@/pages/application-profile';
import { ScheduleInterview } from '@/pages/interviews';

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

type CandidateRecord = Candidate & {
  current_city: string;
  education_level: string;
  school: string;
  work_years: string;
  expected_salary: string;
  source: string;
  gender: string;
  birthday: string;
  intended_role: string;
  current_salary: string;
  work_experience: string;
  education_experience: string;
  remarks: string;
  resume_text: string;
  resume_documents: Application['resumes'];
  updated_at: string;
  can_edit_profile: boolean;
};

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
  }
>(function Candidates({ revision, openApplication, changed }, ref) {
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
  const [detail, setDetail] = useState<number | null>(null);
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
                        <Button variant="link" onClick={() => setDetail(candidate.id)}>
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
                          <Badge variant="secondary" key={value}>
                            {stages[value] || value}
                          </Badge>
                        ))}
                      </div>
                    ),
                  },
                  {
                    title: '操作',
                    width: 80,
                    render: (_, c) => (
                      <Button variant="link" onClick={() => setDetail(c.id)}>
                        详情
                      </Button>
                    ),
                  },
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
          saved={() => {
            setCreating(false);
            resetFilters();
            setNotice('候选人已保存。');
            changed();
          }}
        />
      )}
      {detail !== null && (
        <CandidateDetails
          id={detail}
          changed={changed}
          close={() => setDetail(null)}
          openApplication={(id) => {
            setDetail(null);
            openApplication(id);
          }}
        />
      )}
    </>
  );
});

function CandidateDetails({
  id,
  close,
  openApplication,
  changed,
}: {
  id: number;
  close: () => void;
  openApplication: (id: number) => void;
  changed: () => void;
}) {
  const [person, setPerson] = useState<CandidateRecord | null>(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    api<CandidateRecord>(`candidates/${id}/`, undefined, controller.signal)
      .then(setPerson)
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message);
      });
    return () => controller.abort();
  }, [id, reload]);
  return (
    <Modal
      visible
      title={person ? `${person.display_name} · 候选人详情` : '候选人详情'}
      width={940}
      className="candidate-create-modal"
      closable={!busy}
      maskClosable={!editing && !busy}
      closeOnEsc={!editing && !busy}
      onCancel={() => {
        if (!busy && (!editing || window.confirm('资料还未保存，确定关闭吗？'))) close();
      }}
      footer={
        !editing && (
          <Button variant="outline" onClick={close}>
            关闭
          </Button>
        )
      }
    >
      {error ? (
        <ErrorNotice message={error} retry={() => setReload((value) => value + 1)} />
      ) : !person ? (
        <Loading />
      ) : editing ? (
        <CandidateProfileEditor
          person={person}
          busy={busy}
          setBusy={setBusy}
          cancel={() => setEditing(false)}
          saved={(result) => {
            setPerson(result);
            setEditing(false);
            setNotice('资料已保存。');
            changed();
          }}
        />
      ) : (
        <div className="flex flex-col gap-5">
          {notice && <p role="status">{notice}</p>}
          {person.can_edit_profile && (
            <div>
              <Button variant="outline" onClick={() => setEditing(true)}>
                识别并补全资料
              </Button>
            </div>
          )}
          <dl className="candidate-create-grid">
            {[
              ['姓名', person.display_name],
              ['联系方式', person.phone],
              ['邮箱', person.email],
              ['现居城市', person.current_city],
              ['最高学历', person.education_level],
              ['毕业院校', person.school],
              ['工作年限', person.work_years],
              ['意向岗位', person.intended_role],
              ['当前薪资', person.current_salary],
              ['期望薪资', person.expected_salary],
              ['简历来源', person.source],
              ['联系方式备注', person.contact_note],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-sm text-muted-foreground">{label}</dt>
                <dd className="whitespace-pre-wrap break-words">{value || '—'}</dd>
              </div>
            ))}
          </dl>
          {person.applications.length > 0 && (
            <section className="flex flex-col gap-2" aria-label="应聘记录">
              <h3>应聘记录</h3>
              {person.applications.map((application) => (
                <div key={application.id} className="flex flex-wrap items-center gap-2">
                  <Button variant="link" onClick={() => openApplication(application.id)}>
                    {application.job__title} · 第 {application.attempt_no} 次应聘
                  </Button>
                  <Badge variant="secondary">{stages[application.stage]}</Badge>
                </div>
              ))}
            </section>
          )}
          {[
            ['工作经历', person.work_experience],
            ['教育经历', person.education_experience],
            ['备注', person.remarks],
            ['简历原文', person.resume_text],
          ]
            .filter(([, value]) => value)
            .map(([label, value]) => (
              <section key={label} className="flex flex-col gap-2">
                <h3>{label}</h3>
                <pre className="resume-text">{value}</pre>
              </section>
            ))}
          {person.resume_documents?.length > 0 && (
            <section className="flex flex-col gap-2" aria-label="简历附件">
              <h3>简历附件</h3>
              {person.resume_documents.map((document) => (
                <div key={document.document}>
                  {document.download ? (
                    <a href={`/api/v1/documents/${document.document}/download/`}>{document.name}</a>
                  ) : (
                    <span>{document.name}</span>
                  )}
                </div>
              ))}
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}

function CandidateProfileEditor({
  person,
  busy,
  setBusy,
  cancel,
  saved,
}: {
  person: CandidateRecord;
  busy: boolean;
  setBusy: (value: boolean) => void;
  cancel: () => void;
  saved: (value: CandidateRecord) => void;
}) {
  const documents = person.resume_documents.filter(
    (document) => document.parse?.status === 'succeeded',
  );
  const [documentId, setDocumentId] = useState<number | null>(documents[0]?.document ?? null);
  const document = documents.find((item) => item.document === documentId);
  const initial = Object.fromEntries(
    Object.keys(profileFields).map((key) => [key, person[key as keyof typeof profileFields]]),
  ) as ProfileFields;
  const recognized = document ? resumeFormFields(document.parse?.text ?? '', document.name) : {};
  const [values, setValues] = useState<ProfileFields>(() =>
    Object.fromEntries(
      Object.keys(profileFields).map((key) => [
        key,
        initial[key as keyof typeof profileFields] ||
          recognized[key as keyof typeof profileFields] ||
          '',
      ]),
    ),
  );
  const autofilled = useRef<ProfileFields>(recognized);
  const [error, setError] = useState('');
  return (
    <form
      id="candidate-profile-form"
      className="flex flex-col gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError('');
        try {
          saved(
            await api<CandidateRecord>(`candidates/${person.id}/supplement-profile/`, {
              updated_at: person.updated_at,
              parse: document?.parse?.id ?? null,
              fields: Object.fromEntries(
                Object.entries(values).filter(
                  ([key, value]) => value !== initial[key as keyof typeof profileFields],
                ),
              ),
            }),
          );
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p>
        已根据简历补入可识别的空项，请核对后保存。未写明的现居城市、薪资和招聘来源留空，不根据籍贯或经历推测。
      </p>
      {error && <ErrorNotice message={error} />}
      {documents.length > 0 && (
        <Field>
          <FieldLabel htmlFor="profile-resume-document">用于识别的简历</FieldLabel>
          <Select
            id="profile-resume-document"
            aria-label="用于识别的简历"
            className="candidate-select"
            dropdownClassName="candidate-select-dropdown"
            disabled={busy}
            value={documentId}
            onChange={(value) => {
              const next = documents.find((item) => item.document === value);
              const fields = next ? resumeFormFields(next.parse?.text ?? '', next.name) : {};
              const previous = autofilled.current;
              setValues((current) =>
                Object.fromEntries(
                  Object.keys(profileFields).map((field) => {
                    const key = field as keyof typeof profileFields;
                    return [
                      key,
                      !initial[key] &&
                      (current[key] === previous[key] ||
                        (!current[key] && previous[key] === undefined))
                        ? fields[key] || ''
                        : current[key],
                    ];
                  }),
                ),
              );
              autofilled.current = fields;
              setDocumentId(typeof value === 'number' ? value : null);
            }}
          >
            {documents.map((item) => (
              <Select.Option key={item.document} value={item.document}>
                {item.name}
              </Select.Option>
            ))}
          </Select>
        </Field>
      )}
      <ResumeProfileFields
        values={values}
        change={(key, value) => setValues((old) => ({ ...old, [key]: value }))}
        disabled={busy}
        prefix="profile"
      />
      {document && (
        <details>
          <summary>查看识别依据原文</summary>
          <pre className="resume-text">{document.parse?.text}</pre>
        </details>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" disabled={busy} onClick={cancel}>
          取消
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? '正在保存…' : '保存资料'}
        </Button>
      </div>
    </form>
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

function CreateCandidateDialog({ close, saved }: { close: () => void; saved: () => void }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [gender, setGender] = useState('');
  const [currentCity, setCurrentCity] = useState('');
  const [identityNumber, setIdentityNumber] = useState('');
  const [birthday, setBirthday] = useState('');
  const [intendedRole, setIntendedRole] = useState('');
  const [educationLevel, setEducationLevel] = useState('');
  const [school, setSchool] = useState('');
  const [workYears, setWorkYears] = useState('');
  const [currentSalary, setCurrentSalary] = useState('');
  const [expectedSalary, setExpectedSalary] = useState('');
  const [stage, setStage] = useState('pending_review');
  const [expectedStartDate, setExpectedStartDate] = useState('');
  const [workExperience, setWorkExperience] = useState('');
  const [educationExperience, setEducationExperience] = useState('');
  const [remarks, setRemarks] = useState('');
  const [resumeText, setResumeText] = useState('');
  const [job, setJob] = useState('');
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [draggingResume, setDraggingResume] = useState(false);
  const [attachment, setAttachment] = useState<Pick<
    ImportItem,
    'document' | 'name' | 'parse'
  > | null>(null);
  const [uploading, setUploading] = useState(false);
  const [contactNote, setContactNote] = useState('待补充联系方式');
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
          current === previous || (!current && previous === undefined) ? value : current,
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
      width={940}
      title="新增候选人"
      className="candidate-create-modal"
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
          <Button type="submit" form="create-candidate-form" disabled={busy || !stage}>
            {uploading ? '正在识别…' : busy ? '正在保存…' : '保存'}
          </Button>
        </div>
      }
    >
      <form
        id="create-candidate-form"
        className="candidate-create-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          setError('');
          try {
            await api<{ candidate: number; application: number | null }>('candidates/', {
              request_key: requestKey,
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
              stage,
              expected_start_date: expectedStartDate || null,
              work_experience: workExperience,
              education_experience: educationExperience,
              remarks,
              resume_text: resumeText,
              job: job ? Number(job) : null,
              source,
              ...(attachment
                ? { resume_document: attachment.document, resume_parse: attachment.parse?.id }
                : {}),
            });
            saved();
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
            <FieldLabel htmlFor="new-candidate-gender">性别</FieldLabel>
            <Select
              className="candidate-select"
              id="new-candidate-gender"
              aria-label="性别"
              value={gender}
              onChange={(value) => setGender(typeof value === 'string' ? value : '')}
              placeholder="请选择性别"
              disabled={busy}
              clickToHide
              dropdownClassName="candidate-select-dropdown"
            >
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
            <FieldLabel htmlFor="new-candidate-job">应聘职位</FieldLabel>
            <Select
              className="candidate-select"
              id="new-candidate-job"
              aria-label="应聘职位"
              value={job}
              onChange={(value) => {
                const selected = typeof value === 'string' ? value : '';
                setJob(selected);
                if (!selected) setStage('pending_review');
              }}
              placeholder="暂不关联职位"
              disabled={busy}
              filter
              clickToHide
              dropdownClassName="candidate-select-dropdown"
            >
              <Select.Option value="">暂不关联职位</Select.Option>
              {jobs.map((item) => (
                <Select.Option key={item.id} value={String(item.id)}>
                  {item.title} · {item.department_name}
                </Select.Option>
              ))}
            </Select>
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
            <FieldLabel htmlFor="new-candidate-source">简历来源</FieldLabel>
            <Select
              className="candidate-select"
              id="new-candidate-source"
              aria-label="简历来源"
              value={source}
              onChange={(value) => setSource(typeof value === 'string' ? value : '')}
              placeholder="请选择简历来源"
              disabled={busy}
              clickToHide
              dropdownClassName="candidate-select-dropdown"
            >
              {resumeSources.map((item) => (
                <Select.Option key={item} value={item}>
                  {item}
                </Select.Option>
              ))}
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="new-candidate-education-level">最高学历</FieldLabel>
            <Select
              className="candidate-select"
              id="new-candidate-education-level"
              aria-label="最高学历"
              value={educationLevel}
              onChange={(value) => setEducationLevel(typeof value === 'string' ? value : '')}
              placeholder="请选择学历"
              disabled={busy}
              clickToHide
              dropdownClassName="candidate-select-dropdown"
            >
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
          <Field className="candidate-create-full">
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
          <Field className="candidate-create-full">
            <FieldLabel htmlFor="new-candidate-stage">当前状态</FieldLabel>
            <Select
              className="candidate-select"
              id="new-candidate-stage"
              aria-label="当前状态"
              value={stage}
              onChange={(value) => setStage(typeof value === 'string' ? value : '')}
              disabled={busy || !job}
              clickToHide
              dropdownClassName="candidate-select-dropdown"
            >
              <Select.Option value="pending_review">待筛选</Select.Option>
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
          <Field className="candidate-create-full">
            <FieldLabel htmlFor="new-candidate-expected-start">预计入职日期</FieldLabel>
            <CandidateDatePicker
              id="new-candidate-expected-start"
              value={expectedStartDate}
              onChange={setExpectedStartDate}
              disabled={busy}
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
            <Badge variant="secondary">{stages[data.stage]}</Badge>
            <p>
              来源：{data.source} · HR：{data.owner_name}
            </p>
            <p>{data.phone || data.email || data.contact_note}</p>
          </div>
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
                {r.needs_verification && <Badge variant="outline">岗位要求待确认</Badge>}
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
