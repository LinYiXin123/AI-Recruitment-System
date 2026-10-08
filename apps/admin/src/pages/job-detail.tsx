import { Check, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Blank, ErrorNotice, Loading, Pager } from '@/components/feedback';
import { ProfileRequirementSummary, ProfileRequirements } from '@/components/profile-requirements';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  type Audit,
  api,
  dateTime,
  type Job,
  jobStatus,
  kindLabel,
  type Me,
  type Page,
  type Profile,
  profileStatus,
  type Requirement,
} from '@/lib/api';
import { Clarifications } from '@/pages/clarifications';
import { ProfileAi, type ProfileGeneration } from '@/pages/talent-profiles';

export function CreateJob({
  me,
  close,
  created,
}: {
  me: Me;
  close: () => void;
  created: (job: Job) => void;
}) {
  const [requestId] = useState(() => crypto.randomUUID());
  const [department, setDepartment] = useState(me.departments[0]?.id || 0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [salaryRange, setSalaryRange] = useState('');
  const [baseSalary, setBaseSalary] = useState('');
  const [performanceSalary, setPerformanceSalary] = useState('');
  const [commissionSalary, setCommissionSalary] = useState('');
  const d = me.departments.find((d) => d.id === department);
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !busy && (!dirty || window.confirm('已填写的职位尚未保存，确定关闭吗？')))
          close();
      }}
    >
      <SheetContent side="top" className="profile-settings-dialog job-create-dialog">
        <SheetHeader className="profile-settings-header">
          <SheetTitle>新建职位</SheetTitle>
          <SheetDescription className="sr-only">填写职位基本信息。</SheetDescription>
        </SheetHeader>
        <form
          id="create-job-form"
          className="profile-settings-body job-create-body"
          onChange={() => setDirty(true)}
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setBusy(true);
            setError('');
            try {
              created(
                await api<Job>('jobs/', {
                  request_id: requestId,
                  title: f.get('title'),
                  company_name: f.get('company_name') || '',
                  job_level: f.get('job_level'),
                  salary_range: f.get('salary_range'),
                  base_salary: f.get('base_salary'),
                  performance_salary: f.get('performance_salary'),
                  commission_salary: f.get('commission_salary'),
                  total_monthly_salary: f.get('total_monthly_salary'),
                  planned_publish_date: f.get('planned_publish_date') || null,
                  location: f.get('location'),
                  headcount: Number(f.get('headcount')),
                  department,
                  approver: Number(f.get('approver')),
                  status: f.get('status'),
                  jd: f.get('jd'),
                  collaborators: f.getAll('collaborators').map(Number),
                }),
              );
            } catch (e) {
              setError((e as Error).message);
              setBusy(false);
            }
          }}
        >
          <FieldSet disabled={busy}>
            <FieldGroup className="job-create-grid">
              <Field>
                <FieldLabel htmlFor="title">
                  职位名称
                  <span className="job-required-mark" aria-hidden="true">
                    *
                  </span>
                </FieldLabel>
                <Input
                  name="title"
                  id="title"
                  placeholder="如：招聘专员"
                  maxLength={100}
                  required
                />
              </Field>
              <Field>
                <FieldLabel id="department-label" htmlFor="department">
                  所属部门
                </FieldLabel>
                <NativeSelect
                  aria-labelledby="department-label"
                  id="department"
                  className="w-full"
                  disabled={busy}
                  value={department}
                  onChange={(e) => setDepartment(Number(e.target.value))}
                >
                  {me.departments.map((d) => (
                    <NativeSelectOption key={d.id} value={d.id}>
                      {d.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel id="company-name-label" htmlFor="company_name">
                  所属企业
                </FieldLabel>
                <NativeSelect
                  aria-labelledby="company-name-label"
                  id="company_name"
                  name="company_name"
                  className="w-full"
                  disabled={busy}
                  defaultValue=""
                >
                  <NativeSelectOption value="">不指定企业（选填）</NativeSelectOption>
                  <NativeSelectOption value={me.organization}>{me.organization}</NativeSelectOption>
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="job_level">职级</FieldLabel>
                <Input
                  id="job_level"
                  name="job_level"
                  placeholder="如：P5 / 主管级"
                  maxLength={100}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="salary_range">薪资区间</FieldLabel>
                <div className="job-salary-range">
                  <Input
                    id="salary_range"
                    name="salary_range"
                    value={salaryRange}
                    onChange={(e) => setSalaryRange(e.target.value)}
                    placeholder="如：8-12K（文本，不做数值化）"
                    maxLength={200}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      const parts = [
                        ['底薪', baseSalary],
                        ['绩效', performanceSalary],
                        ['提成', commissionSalary],
                      ].filter(([, value]) => value.trim());
                      setSalaryRange(
                        parts.map(([label, value]) => `${label} ${value}`).join(' + '),
                      );
                    }}
                  >
                    按构成生成
                  </Button>
                </div>
              </Field>
              <Field>
                <FieldLabel htmlFor="base_salary">底薪</FieldLabel>
                <Input
                  id="base_salary"
                  name="base_salary"
                  value={baseSalary}
                  onChange={(e) => setBaseSalary(e.target.value)}
                  placeholder="如：5-7K"
                  maxLength={100}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="performance_salary">绩效</FieldLabel>
                <Input
                  id="performance_salary"
                  name="performance_salary"
                  value={performanceSalary}
                  onChange={(e) => setPerformanceSalary(e.target.value)}
                  placeholder="如：1-2K"
                  maxLength={100}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="commission_salary">提成</FieldLabel>
                <Input
                  id="commission_salary"
                  name="commission_salary"
                  value={commissionSalary}
                  onChange={(e) => setCommissionSalary(e.target.value)}
                  placeholder="如：按课时 2-4K / 上不封顶"
                  maxLength={100}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="total_monthly_salary">综合月薪</FieldLabel>
                <Input
                  id="total_monthly_salary"
                  name="total_monthly_salary"
                  placeholder="如：6-9K（上不封顶）"
                  maxLength={200}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="headcount">招聘人数</FieldLabel>
                <Input
                  type="number"
                  id="headcount"
                  name="headcount"
                  defaultValue={1}
                  min={1}
                  max={32767}
                  required
                />
              </Field>
              <Field>
                <FieldLabel id="job-status-label" htmlFor="status">
                  状态
                </FieldLabel>
                <NativeSelect
                  aria-labelledby="job-status-label"
                  id="status"
                  name="status"
                  className="w-full"
                  disabled={busy}
                  defaultValue="draft"
                >
                  <NativeSelectOption value="draft">草稿</NativeSelectOption>
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="planned_publish_date">发布时间</FieldLabel>
                <Input id="planned_publish_date" name="planned_publish_date" type="date" />
              </Field>
              <Field>
                <FieldLabel htmlFor="location">工作地点</FieldLabel>
                <Input
                  id="location"
                  name="location"
                  placeholder="如：深圳"
                  maxLength={100}
                  required
                />
              </Field>
              <Field>
                <FieldLabel id="approver-label" htmlFor="approver">
                  用人负责人（用于澄清）
                </FieldLabel>
                <NativeSelect
                  aria-labelledby="approver-label"
                  id="approver"
                  name="approver"
                  className="w-full"
                  key={department}
                  disabled={busy}
                  required
                  defaultValue=""
                >
                  <NativeSelectOption value="" disabled>
                    选择用人负责人
                  </NativeSelectOption>
                  {d?.approvers.map((p) => (
                    <NativeSelectOption key={p.id} value={p.id}>
                      {p.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <FieldDescription>
                  {d?.approvers.length
                    ? '有疑问时可向其发起澄清；岗位画像由 HR 核对后直接使用。'
                    : '此部门尚未配置用人负责人，请联系管理员授权。'}
                </FieldDescription>
              </Field>
              {!!d?.collaborators.length && (
                <FieldSet className="job-create-span-2">
                  <FieldLegend>协作 HR（可选）</FieldLegend>
                  {d.collaborators.map((p) => (
                    <Field key={p.id} orientation="horizontal">
                      <input type="checkbox" id={`col-${p.id}`} name="collaborators" value={p.id} />
                      <FieldLabel htmlFor={`col-${p.id}`}>{p.name}</FieldLabel>
                    </Field>
                  ))}
                </FieldSet>
              )}
              <Field className="job-create-span-2">
                <FieldLabel htmlFor="jd">任职要求</FieldLabel>
                <Textarea
                  id="jd"
                  name="jd"
                  rows={4}
                  maxLength={30000}
                  placeholder="一行一条，便于阅读"
                />
              </Field>
              {error && (
                <div className="job-create-span-2">
                  <ErrorNotice message={error} />
                </div>
              )}
            </FieldGroup>
          </FieldSet>
        </form>
        <SheetFooter className="profile-settings-footer job-create-footer">
          <Button
            variant="outline"
            type="button"
            disabled={busy}
            onClick={() => {
              if (!dirty || window.confirm('放弃尚未保存的职位内容？')) close();
            }}
          >
            取消
          </Button>
          <Button type="submit" form="create-job-form" disabled={busy || !d?.approvers.length}>
            {busy ? '正在保存…' : '保存'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export function JobDetail({
  id,
  initialTab = 'requirements',
  initialEditing = false,
  close,
  changed,
  onViewCandidates,
}: {
  id: number;
  initialTab?: string;
  initialEditing?: boolean;
  close: () => void;
  changed: () => void;
  onViewCandidates?: (job: Job) => void;
}) {
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(initialEditing);
  const [profileDirty, setProfileDirty] = useState(false);
  const [tab, setTab] = useState(initialTab);
  const [clarificationDirty, setClarificationDirty] = useState(false);
  const [nextStatus, setNextStatus] = useState('');
  const [reason, setReason] = useState('');
  const returnFocus = useRef<HTMLElement | null>(document.activeElement as HTMLElement);
  const load = useCallback(async () => {
    setError('');
    try {
      const loaded = await api<Job>(`jobs/${id}/`);
      setJob(loaded);
      if (!loaded.permissions.edit || loaded.status === 'closed') setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  async function act(endpoint: string, data: Record<string, unknown>, message: string) {
    if (!job || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      setJob(await api<Job>(`jobs/${id}/${endpoint}/`, { version: job.version, ...data }));
      setNotice(message);
      setNextStatus('');
      setReason('');
      changed();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function requestClose() {
    const unsaved = profileDirty || clarificationDirty || reason.trim();
    if (!busy && (!unsaved || window.confirm('还有尚未保存的内容，确定关闭吗？'))) {
      close();
      returnFocus.current?.focus();
    }
  }
  const p = job?.latest_profile;
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) requestClose();
      }}
    >
      <SheetContent className="job-sheet" finalFocus={returnFocus}>
        <SheetHeader>
          <div className="flex items-center gap-3">
            <Badge variant="secondary">职位详情</Badge>
            {job && (
              <Badge variant={job.status === 'open' ? 'default' : 'outline'}>
                {jobStatus[job.status]}
              </Badge>
            )}
          </div>
          <SheetTitle>{job?.title || '正在读取职位'}</SheetTitle>
          <SheetDescription>
            {job
              ? `${job.department_name} · ${job.location} · 计划 ${job.headcount} 人`
              : '正在读取你获授权的职位信息'}
          </SheetDescription>
        </SheetHeader>
        <div className={editing && job ? 'flex min-h-0 flex-1 flex-col' : 'sheet-scroll'}>
          {notice && (
            <p className="success-notice" role="status">
              <Check />
              {notice}
            </p>
          )}
          {error && (
            <ErrorNotice
              message={error}
              retry={() => {
                if (
                  (!profileDirty && !clarificationDirty) ||
                  window.confirm('重新加载会放弃未保存的编辑，是否继续？')
                ) {
                  setEditing(false);
                  setProfileDirty(false);
                  setClarificationDirty(false);
                  setTab('requirements');
                  void load();
                }
              }}
            />
          )}
          {!job ? (
            !error && <Loading />
          ) : editing ? (
            <ProfileEditor
              job={job}
              busy={busy}
              setBusy={setBusy}
              onDirty={() => setProfileDirty(true)}
              cancel={() => {
                if (!profileDirty || window.confirm('放弃本次未保存的招人要求？')) {
                  setEditing(false);
                  setProfileDirty(false);
                }
              }}
              saved={(j) => {
                setJob(j);
                setEditing(false);
                setProfileDirty(false);
                setNotice(
                  j.latest_profile?.status === 'confirmed'
                    ? '招人要求已保存并使用，可以继续查看候选人的简历。'
                    : '要求草稿已保存，暂不用于分析，可以继续修改。',
                );
                changed();
              }}
            />
          ) : (
            <Tabs
              value={tab}
              onValueChange={(value) => {
                if (
                  busy ||
                  (clarificationDirty && !window.confirm('澄清问答尚未保存，确定离开吗？'))
                )
                  return;
                setClarificationDirty(false);
                setTab(String(value));
              }}
            >
              <TabsList>
                <TabsTrigger value="requirements">招人要求</TabsTrigger>
                <TabsTrigger value="clarifications">澄清问答</TabsTrigger>
                <TabsTrigger value="history">版本与记录</TabsTrigger>
                <TabsTrigger value="info">职位信息</TabsTrigger>
              </TabsList>
              <TabsContent value="requirements" className="detail-tab">
                <div className="section-heading">
                  <div>
                    <h2>
                      内部招人要求{' '}
                      {p && (
                        <Badge variant="outline">
                          v{p.number} · {profileStatus[p.status]}
                        </Badge>
                      )}
                    </h2>
                    <p>经办 HR：{job.owner_name} · 编辑后由有权限的 HR 直接使用</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {job.permissions.edit && job.status !== 'closed' && (
                      <>
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() => {
                            setEditing(true);
                            setError('');
                            setNotice('');
                          }}
                        >
                          {p ? '调整要求' : '填写招人要求'}
                        </Button>
                        <Button
                          disabled={busy}
                          onClick={() => {
                            setEditing(true);
                            setError('');
                            setNotice('');
                          }}
                        >
                          <Sparkles data-icon="inline-start" />
                          AI 起草招人要求
                        </Button>
                      </>
                    )}
                    {onViewCandidates && job.active_profile && (
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                          const unsaved = profileDirty || clarificationDirty || reason.trim();
                          if (!unsaved || window.confirm('还有尚未保存的内容，确定离开吗？'))
                            onViewCandidates(job);
                        }}
                      >
                        查看候选人
                      </Button>
                    )}
                  </div>
                </div>
                {job.active_profile && job.active_profile !== p?.id && (
                  <p className="source-note">
                    目前仍用第 {job.active_profile_number} 版要求分析简历。新版本使用后才会替换。
                  </p>
                )}
                {p ? (
                  <>
                    <ProfileContent profile={p} />
                    {p.review_note && (
                      <div className="review-note">
                        <strong>历史版本反馈</strong>
                        <p>{p.review_note}</p>
                      </div>
                    )}
                    {['draft', 'pending', 'changes_requested'].includes(p.status) &&
                      job.permissions.edit &&
                      job.status !== 'closed' && (
                        <div className="action-panel">
                          <div>
                            <strong>核对完成后，直接使用此版本</strong>
                            <p>
                              以后分析简历会使用这份要求，历史记录保留。由你直接使用，无需另找负责人审批。
                            </p>
                          </div>
                          <Button
                            disabled={busy}
                            onClick={() =>
                              void act('activate-profile', {}, '此版本已生效，无需另外审批。')
                            }
                          >
                            {busy ? '正在使用…' : '使用此版本'}
                          </Button>
                        </div>
                      )}
                  </>
                ) : (
                  <Blank
                    title="把招人依据整理在一起"
                    description="填写要求或用 AI 起草，核对后保存并使用，即可作为本职位的招人依据。"
                  />
                )}
                {p?.status === 'confirmed' &&
                  job.permissions.edit &&
                  ['draft', 'paused'].includes(job.status) && (
                    <div className="action-panel">
                      <div>
                        <strong>招人要求已生效</strong>
                        <p>可以开始招聘；外部渠道发布单独记录，不会在此自动发布。</p>
                      </div>
                      <Button
                        disabled={busy}
                        onClick={() =>
                          void act('change-status', { status: 'open' }, '职位已开始招聘。')
                        }
                      >
                        {job.status === 'paused' ? '恢复招聘' : '开始招聘'}
                      </Button>
                    </div>
                  )}
              </TabsContent>
              <TabsContent value="clarifications" className="detail-tab">
                <Clarifications
                  job={job}
                  busy={busy}
                  setBusy={setBusy}
                  dirty={setClarificationDirty}
                  failed={(message) => {
                    setError(message);
                    setNotice('');
                  }}
                  saved={(j, message) => {
                    setJob(j);
                    setClarificationDirty(false);
                    setError('');
                    setNotice(message);
                    changed();
                  }}
                />
              </TabsContent>
              <TabsContent value="history" className="detail-tab">
                <History id={id} version={job.version} />
              </TabsContent>
              <TabsContent value="info" className="detail-tab">
                <dl className="job-meta">
                  <div>
                    <dt>所属部门</dt>
                    <dd>{job.department_name}</dd>
                  </div>
                  <div>
                    <dt>所属企业</dt>
                    <dd>{job.company_name || '未指定'}</dd>
                  </div>
                  <div>
                    <dt>职级</dt>
                    <dd>{job.job_level || '未填写'}</dd>
                  </div>
                  <div>
                    <dt>薪资区间</dt>
                    <dd>{job.salary_range || '未填写'}</dd>
                  </div>
                  <div>
                    <dt>HR 负责人</dt>
                    <dd>{job.owner_name}</dd>
                  </div>
                  <div>
                    <dt>用人负责人</dt>
                    <dd>{job.approver_name}</dd>
                  </div>
                  <div>
                    <dt>招聘人数</dt>
                    <dd>{job.headcount} 人</dd>
                  </div>
                  <div>
                    <dt>发布时间</dt>
                    <dd>{job.planned_publish_date || '未设置'}</dd>
                  </div>
                </dl>
                <h2>对外职位描述</h2>
                <p className="preserve-text">{job.jd || '尚未填写，可在招人要求中补充。'}</p>
                {job.permissions.edit && (
                  <FieldGroup>
                    <Field>
                      <FieldLabel id="next-status-label" htmlFor="next-status">
                        调整职位状态
                      </FieldLabel>
                      <NativeSelect
                        aria-labelledby="next-status-label"
                        id="next-status"
                        disabled={busy}
                        value={nextStatus}
                        onChange={(e) => setNextStatus(e.target.value)}
                      >
                        <NativeSelectOption value="">选择下一步</NativeSelectOption>
                        {job.status === 'open' && (
                          <NativeSelectOption value="paused">暂停招聘</NativeSelectOption>
                        )}
                        {job.status !== 'closed' && (
                          <NativeSelectOption value="closed">关闭职位</NativeSelectOption>
                        )}
                        {job.status === 'closed' && (
                          <NativeSelectOption value="draft">重新开启为草稿</NativeSelectOption>
                        )}
                      </NativeSelect>
                    </Field>
                    {nextStatus && (
                      <>
                        <Field>
                          <FieldLabel htmlFor="status-reason">调整原因</FieldLabel>
                          <Textarea
                            id="status-reason"
                            disabled={busy}
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            maxLength={1000}
                          />
                          <FieldDescription>
                            关闭职位会撤回尚未完成的要求确认待办，并保留已有历史。
                          </FieldDescription>
                        </Field>
                        <Button
                          disabled={busy || !reason.trim()}
                          onClick={() =>
                            void act(
                              'change-status',
                              { status: nextStatus, reason },
                              '职位状态已更新，调整原因已记录。',
                            )
                          }
                        >
                          确认调整
                        </Button>
                      </>
                    )}
                  </FieldGroup>
                )}
              </TabsContent>
            </Tabs>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ProfileContent({ profile: p }: { profile: Profile }) {
  return (
    <div className="profile-content">
      {(['must', 'preferred', 'exclusion'] as const).map((kind) => {
        const items = p.requirements.filter((r) => r.kind === kind);
        return (
          items.length > 0 && (
            <section key={kind}>
              <h3>{kindLabel[kind]}</h3>
              <ul>
                {items.map((r) => (
                  <li key={r.id}>
                    <p>
                      {r.text} {r.needs_verification && <Badge variant="outline">要求未确定</Badge>}
                    </p>
                    {(r.rationale || r.source_quote || r.source_kind) && (
                      <details>
                        <summary className="cursor-pointer">查看来源和原因</summary>
                        {r.rationale && <small>为什么需要这项要求：{r.rationale}</small>}
                        {r.source_quote && (
                          <blockquote className="preserve-text">
                            原始依据：{r.source_quote}
                          </blockquote>
                        )}
                        {r.source_kind && (
                          <small>
                            来源：
                            {r.source_kind === 'jd'
                              ? '职位描述'
                              : r.source_kind === 'business_goal'
                                ? '入职目标'
                                : r.source_kind === 'clarification'
                                  ? '澄清答复'
                                  : r.source_kind === 'ai_suggestion'
                                    ? 'AI 建议'
                                    : '人工记录'}
                            {r.source_edited && ' · HR 已修改'}
                          </small>
                        )}
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )
        );
      })}
      <details className="source-note">
        <summary className="cursor-pointer">查看这版要求的来源与保存记录</summary>
        {p.business_goal && <p>入职目标：{p.business_goal}</p>}
        来源：{p.source}
        <br />
        {p.created_by_name} · {dateTime(p.created_at)} 保存
        {p.confirmed_at && (
          <>
            <br />
            {p.confirmed_by_name} · {dateTime(p.confirmed_at)} 使用此版本
          </>
        )}
      </details>
      <details>
        <summary>查看此版本的对外职位描述</summary>
        <p className="preserve-text">{p.jd_snapshot}</p>
      </details>
    </div>
  );
}

function ProfileChanges({
  job,
  requirements,
  jd,
  businessGoal,
}: {
  job: Job;
  requirements: Requirement[];
  jd: string;
  businessGoal: string;
}) {
  const [active, setActive] = useState<Profile | null>(
    job.latest_profile?.id === job.active_profile ? job.latest_profile : null,
  );
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!job.active_profile || job.latest_profile?.id === job.active_profile) return;
    const controller = new AbortController();
    setError('');
    void (async () => {
      for (let page = 1; ; page++) {
        const result = await api<Page<Profile>>(
          `jobs/${job.id}/profiles/?page=${page}`,
          undefined,
          controller.signal,
        );
        const current = result.results.find((profile) => profile.id === job.active_profile);
        if (current) {
          setActive(current);
          return;
        }
        if (!result.next) throw new Error('未能读取当前生效版，暂时无法比较变化。');
      }
    })().catch((e) => {
      if (e.name !== 'AbortError') setError(e.message);
    });
    return () => controller.abort();
  }, [job.id, job.active_profile, job.latest_profile?.id, retry]);
  if (!job.active_profile) return null;
  if (error) return <ErrorNotice message={error} retry={() => setRetry((value) => value + 1)} />;
  if (!active) return <p role="status">正在读取生效版本，核对本次变化…</p>;
  const content = (r: Requirement) =>
    JSON.stringify([r.kind, r.text.trim(), r.rationale.trim(), r.needs_verification]);
  const remaining = [...active.requirements];
  let added = 0;
  let modified = 0;
  for (const requirement of requirements) {
    const original =
      requirement.id == null
        ? requirement
        : job.latest_profile?.requirements.find((item) => item.id === requirement.id) ||
          requirement;
    const sameId = remaining.findIndex(
      (before) => requirement.id != null && before.id === requirement.id,
    );
    const index =
      sameId >= 0 ? sameId : remaining.findIndex((before) => content(before) === content(original));
    if (index < 0) added++;
    else {
      if (content(remaining[index]) !== content(requirement)) modified++;
      remaining.splice(index, 1);
    }
  }
  return (
    <Alert aria-label="与生效版本比较">
      <AlertTitle>相对当前生效 v{active.number}</AlertTitle>
      <AlertDescription>
        <p>
          要求变更：新增 {added} · 删除 {remaining.length} · 修改 {modified}
        </p>
        {jd.trim() !== active.jd_snapshot.trim() && <p>职位描述有调整</p>}
        {businessGoal.trim() !== (active.business_goal || '').trim() && <p>入职目标有调整</p>}
        <p>保存草稿时仍用旧要求；保存并使用后，新的分析使用这版要求，已有报告保留。</p>
      </AlertDescription>
    </Alert>
  );
}

function ProfileEditor({
  job,
  busy,
  setBusy,
  onDirty,
  cancel,
  saved,
}: {
  job: Job;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onDirty: () => void;
  cancel: () => void;
  saved: (j: Job) => void;
}) {
  const [requirements, setRequirements] = useState<(Requirement & { key: string })[]>(
    (
      job.latest_profile?.requirements || [
        { kind: 'must' as const, text: '', rationale: '', needs_verification: false },
      ]
    ).map((r) => ({ ...r, key: crypto.randomUUID() })),
  );
  const [error, setError] = useState('');
  const [jd, setJd] = useState(job.jd);
  const [source, setSource] = useState(job.latest_profile?.source || '');
  const [businessGoal, setBusinessGoal] = useState(job.latest_profile?.business_goal || '');
  const [generation, setGeneration] = useState<ProfileGeneration | null>(null);
  const [materialsOpen, setMaterialsOpen] = useState(!job.jd.trim() || !job.latest_profile?.source);
  const inputChanged = Boolean(
    generation &&
      (generation.input.jd !== jd.trim() || generation.input.business_goal !== businessGoal.trim()),
  );
  const unverified = requirements.some((r) => r.kind === 'must' && r.needs_verification);
  return (
    <>
      <form
        id="job-profile-form"
        className="sheet-scroll"
        onChange={onDirty}
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy || inputChanged) return;
          const activate =
            (e.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'activate';
          setBusy(true);
          setError('');
          try {
            saved(
              await api<Job>(`jobs/${job.id}/profiles/`, {
                version: job.version,
                jd,
                source,
                business_goal: businessGoal,
                generation_id: generation?.id ?? null,
                activate,
                requirements: requirements.map(({ key: _key, ...r }) => r),
              }),
            );
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <FieldSet disabled={busy}>
          <FieldGroup>
            <div className="section-heading">
              <div>
                <h2>AI 辅助整理岗位要求</h2>
                <p>本次保存为 v{(job.latest_profile?.number || 0) + 1}，历史版本会保留。</p>
              </div>
            </div>
            <ProfileRequirementSummary requirements={requirements} />
            <ProfileChanges
              job={job}
              requirements={requirements}
              jd={jd}
              businessGoal={businessGoal}
            />
            <details
              className="rounded-lg border p-4"
              open={materialsOpen}
              onToggle={(event) => setMaterialsOpen(event.currentTarget.open)}
              onInvalidCapture={(event) => {
                event.currentTarget.open = true;
                setMaterialsOpen(true);
              }}
            >
              <summary className="cursor-pointer">招聘说明与入职目标</summary>
              <FieldGroup className="mt-4">
                <Field>
                  <FieldLabel htmlFor="profile-jd">对外职位描述</FieldLabel>
                  <FieldDescription id="profile-jd-help">
                    粘贴招聘说明，或写清要做什么工作、必须会什么。AI 会据此整理招人要求。
                  </FieldDescription>
                  <Textarea
                    id="profile-jd"
                    aria-describedby="profile-jd-help"
                    value={jd}
                    onChange={(e) => setJd(e.target.value)}
                    rows={5}
                    maxLength={30000}
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="profile-goal">希望入职后完成什么（可选）</FieldLabel>
                  <Textarea
                    id="profile-goal"
                    value={businessGoal}
                    maxLength={5000}
                    rows={3}
                    placeholder="希望这个人解决什么问题、入职后完成什么结果？"
                    onChange={(e) => setBusinessGoal(e.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="profile-source">要求来源</FieldLabel>
                  <Input
                    id="profile-source"
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                    placeholder="例如：招聘需求、业务说明或 HR 补充"
                    maxLength={500}
                    required
                  />
                  <FieldDescription>例如：用人部门的招聘说明、需求讨论记录。</FieldDescription>
                </Field>
              </FieldGroup>
            </details>
            <ProfileAi
              job={job}
              jd={jd}
              businessGoal={businessGoal}
              busy={busy}
              setBusy={setBusy}
              restoreInput={(input) => {
                onDirty();
                setJd(input.jd);
                setBusinessGoal(input.business_goal);
              }}
              adopt={(generation, items) => {
                onDirty();
                setRequirements(items.map((r) => ({ ...r, key: crypto.randomUUID() })));
                setGeneration(generation);
                setSource('AI 起草，HR 核对');
                setError('');
              }}
            />
            <ProfileRequirements
              requirements={requirements}
              busy={busy}
              onChange={(next) => {
                onDirty();
                setRequirements(next);
              }}
            />
          </FieldGroup>
        </FieldSet>
      </form>
      <SheetFooter className="shrink-0 border-t bg-background">
        {error && <ErrorNotice message={error} />}
        {inputChanged && (
          <p role="status">
            招聘说明或入职目标已修改，已采用的 AI
            草稿需要重新生成并采用后才能保存。你填写的内容已保留。
          </p>
        )}
        {unverified && (
          <p role="status">还有“必须满足”的招人要求没确定，请先明确，或保存草稿继续完善。</p>
        )}
        <p className="text-sm text-muted-foreground">
          保存要求草稿：留着继续改，暂不替换当前要求。保存并使用：以后分析此职位的简历时使用这份要求。
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={cancel}>
            取消编辑
          </Button>
          <Button
            type="submit"
            form="job-profile-form"
            variant="outline"
            disabled={busy || inputChanged}
          >
            {busy ? '正在保存…' : '保存要求草稿'}
          </Button>
          <Button
            type="submit"
            form="job-profile-form"
            value="activate"
            disabled={busy || unverified || inputChanged}
          >
            保存并使用
          </Button>
        </div>
      </SheetFooter>
    </>
  );
}

function History({ id, version }: { id: number; version: number }) {
  const [profiles, setProfiles] = useState<Page<Profile> | null>(null);
  const [events, setEvents] = useState<Page<Audit> | null>(null);
  const [page, setPage] = useState(1);
  const [eventPage, setEventPage] = useState(1);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    setError('');
    setProfiles(null);
    setEvents(null);
    void Promise.all([
      api<Page<Profile>>(`jobs/${id}/profiles/?page=${page}`, undefined, c.signal),
      api<Page<Audit>>(`jobs/${id}/history/?page=${eventPage}`, undefined, c.signal),
    ])
      .then(([p, e]) => {
        setProfiles(p);
        setEvents(e);
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message);
      });
    return () => c.abort();
  }, [id, version, page, eventPage, reload]);
  if (error) return <ErrorNotice message={error} retry={() => setReload((r) => r + 1)} />;
  if (!profiles || !events) return <Loading />;
  return (
    <>
      <h2>招人要求版本</h2>
      {profiles.results.length === 0 ? (
        <p>尚未保存招人要求。</p>
      ) : (
        profiles.results.map((p) => (
          <details className="version-block" key={p.id}>
            <summary>
              v{p.number} · {profileStatus[p.status]} <span>{dateTime(p.created_at)}</span>
            </summary>
            <ProfileContent profile={p} />
            {p.review_note && <p className="review-note">确认备注：{p.review_note}</p>}
          </details>
        ))
      )}
      {profiles.count > 20 && <Pager page={page} count={profiles.count} onChange={setPage} />}
      <h2>操作记录</h2>
      <ol className="audit-list">
        {events.results.map((e) => (
          <li key={e.id}>
            <strong>{e.action}</strong>
            <p>
              {e.actor_name} · {dateTime(e.created_at)}
            </p>
            {e.note && <p>{e.note}</p>}
          </li>
        ))}
      </ol>
      {events.count > 20 && <Pager page={eventPage} count={events.count} onChange={setEventPage} />}
    </>
  );
}
