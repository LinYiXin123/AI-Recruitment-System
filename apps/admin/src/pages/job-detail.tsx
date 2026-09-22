import { Check, Plus, Send, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Blank, ErrorNotice, Loading, Pager } from '@/components/feedback';
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
  const d = me.departments.find((d) => d.id === department);
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !busy && (!dirty || window.confirm('已填写的职位尚未保存，确定关闭吗？')))
          close();
      }}
    >
      <SheetContent className="job-sheet">
        <SheetHeader>
          <SheetTitle>新建职位</SheetTitle>
          <SheetDescription>先填写基本需求，保存后继续整理招人要求。</SheetDescription>
        </SheetHeader>
        <form
          className="sheet-scroll"
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
                  location: f.get('location'),
                  headcount: Number(f.get('headcount')),
                  department,
                  approver: Number(f.get('approver')),
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
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="title">职位名称</FieldLabel>
                <Input
                  name="title"
                  id="title"
                  placeholder="例如：产品经理"
                  maxLength={100}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="department">用人部门</FieldLabel>
                <NativeSelect
                  id="department"
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
              <div className="two-fields">
                <Field>
                  <FieldLabel htmlFor="location">工作地点</FieldLabel>
                  <Input
                    id="location"
                    name="location"
                    placeholder="例如：深圳"
                    maxLength={100}
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="headcount">计划招聘人数</FieldLabel>
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
              </div>
              <Field>
                <FieldLabel htmlFor="approver">招人要求确认人</FieldLabel>
                <NativeSelect
                  id="approver"
                  name="approver"
                  key={department}
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
                    ? '提交招人要求后，这位负责人会收到工作台待办。'
                    : '此部门尚未配置用人负责人，请联系管理员授权。'}
                </FieldDescription>
              </Field>
              {!!d?.collaborators.length && (
                <FieldSet>
                  <FieldLegend>协作 HR（可选）</FieldLegend>
                  {d.collaborators.map((p) => (
                    <Field key={p.id} orientation="horizontal">
                      <input type="checkbox" id={`col-${p.id}`} name="collaborators" value={p.id} />
                      <FieldLabel htmlFor={`col-${p.id}`}>{p.name}</FieldLabel>
                    </Field>
                  ))}
                </FieldSet>
              )}
              <Field>
                <FieldLabel htmlFor="jd">对外职位描述（可稍后完善）</FieldLabel>
                <Textarea
                  id="jd"
                  name="jd"
                  rows={5}
                  maxLength={30000}
                  placeholder="介绍工作职责与岗位价值，内部判断标准在下一步填写。"
                />
              </Field>
              {error && <ErrorNotice message={error} />}
              <div className="form-actions">
                <Button
                  variant="outline"
                  type="button"
                  onClick={() => {
                    if (!dirty || window.confirm('放弃尚未保存的职位内容？')) close();
                  }}
                >
                  取消
                </Button>
                <Button type="submit" disabled={busy || !d?.approvers.length}>
                  {busy ? '正在保存…' : '保存并填写招人要求'}
                </Button>
              </div>
            </FieldGroup>
          </FieldSet>
        </form>
      </SheetContent>
    </Sheet>
  );
}

export function JobDetail({
  id,
  close,
  changed,
}: {
  id: number;
  close: () => void;
  changed: () => void;
}) {
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [reviewNote, setReviewNote] = useState('');
  const [nextStatus, setNextStatus] = useState('');
  const [reason, setReason] = useState('');
  const returnFocus = useRef<HTMLElement | null>(document.activeElement as HTMLElement);
  const load = useCallback(async () => {
    setError('');
    try {
      setJob(await api<Job>(`jobs/${id}/`));
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
      setReviewNote('');
      changed();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function requestClose() {
    if (!busy && (!editing || window.confirm('招人要求尚未保存，确定关闭吗？'))) {
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
        <div className="sheet-scroll">
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
                if (!editing || window.confirm('重新加载会放弃未保存的编辑，是否继续？')) {
                  setEditing(false);
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
              cancel={() => {
                if (window.confirm('放弃本次未保存的招人要求？')) setEditing(false);
              }}
              saved={(j) => {
                setJob(j);
                setEditing(false);
                setNotice('新版本已保存。提交后将由负责人确认。');
                changed();
              }}
            />
          ) : (
            <Tabs defaultValue="requirements">
              <TabsList>
                <TabsTrigger value="requirements">招人要求</TabsTrigger>
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
                    <p>确认人：{job.approver_name}</p>
                  </div>
                  {job.permissions.edit && job.status !== 'closed' && (
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
                  )}
                </div>
                {job.active_profile && job.active_profile !== p?.id && (
                  <p className="source-note">
                    当前正式依据仍为 v{job.active_profile_number}。新版本确认前，不会替换原有依据。
                  </p>
                )}
                {p ? (
                  <>
                    <ProfileContent profile={p} />
                    {p.review_note && (
                      <div className="review-note">
                        <strong>
                          {p.status === 'changes_requested' ? '负责人需要补充' : '负责人备注'}
                        </strong>
                        <p>{p.review_note}</p>
                      </div>
                    )}
                    {p.status === 'draft' && job.permissions.edit && (
                      <div className="action-panel">
                        <div>
                          <strong>准备好后，邀请负责人确认</strong>
                          <p>将为 {job.approver_name} 创建待办，确认前此版本仍为草稿。</p>
                        </div>
                        <Button
                          disabled={busy}
                          onClick={() =>
                            void act('submit-profile', {}, '已提交，等待用人负责人确认。')
                          }
                        >
                          <Send data-icon="inline-start" />
                          {busy ? '正在提交…' : '提交确认'}
                        </Button>
                      </div>
                    )}
                    {p.status === 'pending' && (
                      <div className="action-panel">
                        <div>
                          <strong>等待 {job.approver_name} 确认</strong>
                          <p>调整要求会撤回本次待办，并生成新的草稿版本。</p>
                        </div>
                      </div>
                    )}
                    {p.status === 'pending' && job.permissions.confirm && (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          void act(
                            'review-profile',
                            { outcome: 'confirm', note: reviewNote },
                            '招人要求已确认，相关待办已完成。',
                          );
                        }}
                      >
                        <FieldGroup>
                          <Field>
                            <FieldLabel htmlFor="review-note">确认备注 / 需补充内容</FieldLabel>
                            <Textarea
                              id="review-note"
                              value={reviewNote}
                              onChange={(e) => setReviewNote(e.target.value)}
                              maxLength={1000}
                              placeholder="确认可不填；需要补充时，请说明具体内容。"
                            />
                          </Field>
                          <div className="form-actions">
                            <Button
                              variant="outline"
                              disabled={busy || !reviewNote.trim()}
                              onClick={() =>
                                void act(
                                  'review-profile',
                                  { outcome: 'changes_requested', note: reviewNote },
                                  '已记录需要补充的内容，HR 可修改后重新提交。',
                                )
                              }
                            >
                              请 HR 补充
                            </Button>
                            <Button type="submit" disabled={busy}>
                              <Check data-icon="inline-start" />
                              {busy ? '正在保存…' : '确认招人要求'}
                            </Button>
                          </div>
                        </FieldGroup>
                      </form>
                    )}
                  </>
                ) : (
                  <Blank
                    title="把招人依据整理在一起"
                    description="分别记录必须满足、优先考虑和排除信号，并注明依据来源。负责人确认后，才能开始招聘。"
                  />
                )}
                {p?.status === 'confirmed' &&
                  job.permissions.edit &&
                  ['draft', 'paused'].includes(job.status) && (
                    <div className="action-panel">
                      <div>
                        <strong>招人要求已确认</strong>
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
              <TabsContent value="history" className="detail-tab">
                <History id={id} version={job.version} />
              </TabsContent>
              <TabsContent value="info" className="detail-tab">
                <dl className="job-meta">
                  <div>
                    <dt>HR 负责人</dt>
                    <dd>{job.owner_name}</dd>
                  </div>
                  <div>
                    <dt>用人负责人</dt>
                    <dd>{job.approver_name}</dd>
                  </div>
                  <div>
                    <dt>计划招聘</dt>
                    <dd>{job.headcount} 人</dd>
                  </div>
                  <div>
                    <dt>最近更新</dt>
                    <dd>{dateTime(job.updated_at)}</dd>
                  </div>
                </dl>
                <h2>对外职位描述</h2>
                <p className="preserve-text">{job.jd || '尚未填写，可在招人要求中补充。'}</p>
                {job.permissions.edit && (
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="next-status">调整职位状态</FieldLabel>
                      <NativeSelect
                        id="next-status"
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
                      {r.text} {r.needs_verification && <Badge variant="outline">待核实</Badge>}
                    </p>
                    {r.rationale && <small>岗位关系与依据：{r.rationale}</small>}
                  </li>
                ))}
              </ul>
            </section>
          )
        );
      })}
      <div className="source-note">
        来源：{p.source}
        <br />
        {p.created_by_name} · {dateTime(p.created_at)} 保存
        {p.confirmed_at && (
          <>
            <br />
            {p.confirmed_by_name} · {dateTime(p.confirmed_at)} 确认
          </>
        )}
      </div>
      <details>
        <summary>查看此版本的对外职位描述</summary>
        <p className="preserve-text">{p.jd_snapshot}</p>
      </details>
    </div>
  );
}

function ProfileEditor({
  job,
  cancel,
  saved,
}: {
  job: Job;
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [jd, setJd] = useState(job.jd);
  const [source, setSource] = useState(job.latest_profile?.source || '');
  function update(key: string, change: Partial<Requirement>) {
    setRequirements((rs) => rs.map((r) => (r.key === key ? { ...r, ...change } : r)));
  }
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
          saved(
            await api<Job>(`jobs/${job.id}/profiles/`, {
              version: job.version,
              jd,
              source,
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
              <h2>{job.latest_profile ? '调整招人要求' : '填写招人要求'}</h2>
              <p>本次保存为 v{(job.latest_profile?.number || 0) + 1}，历史版本会保留。</p>
            </div>
          </div>
          <Field>
            <FieldLabel htmlFor="profile-jd">对外职位描述</FieldLabel>
            <Textarea
              id="profile-jd"
              value={jd}
              onChange={(e) => setJd(e.target.value)}
              rows={5}
              maxLength={30000}
              required
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="profile-source">要求来源</FieldLabel>
            <Input
              id="profile-source"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="例如：9 月用人需求会议、负责人书面说明"
              maxLength={500}
              required
            />
          </Field>
          {requirements.map((r, i) => (
            <FieldSet key={r.key} className="requirement-editor">
              <FieldLegend>要求 {i + 1}</FieldLegend>
              <div className="flex items-center justify-between gap-3">
                <NativeSelect
                  aria-label={`要求 ${i + 1} 类型`}
                  value={r.kind}
                  onChange={(e) => update(r.key, { kind: e.target.value as Requirement['kind'] })}
                >
                  {Object.entries(kindLabel).map(([v, l]) => (
                    <NativeSelectOption key={v} value={v}>
                      {l}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`删除要求 ${i + 1}`}
                  disabled={requirements.length <= 1}
                  onClick={() => setRequirements((rs) => rs.filter((x) => x.key !== r.key))}
                >
                  <Trash2 />
                </Button>
              </div>
              <Field>
                <FieldLabel htmlFor={`req-${r.key}`}>具体要求 {i + 1}</FieldLabel>
                <Textarea
                  id={`req-${r.key}`}
                  value={r.text}
                  onChange={(e) => update(r.key, { text: e.target.value })}
                  maxLength={1000}
                  required
                  placeholder="写清楚可核对的能力、经历或工作条件。"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`why-${r.key}`}>
                  岗位关系与依据{r.kind !== 'exclusion' ? '（可选）' : ''}
                </FieldLabel>
                <Input
                  id={`why-${r.key}`}
                  value={r.rationale}
                  onChange={(e) => update(r.key, { rationale: e.target.value })}
                  maxLength={1000}
                  required={r.kind === 'exclusion'}
                />
              </Field>
              <Field orientation="horizontal">
                <input
                  id={`verify-${r.key}`}
                  type="checkbox"
                  checked={r.needs_verification}
                  onChange={(e) => update(r.key, { needs_verification: e.target.checked })}
                />
                <FieldLabel htmlFor={`verify-${r.key}`}>
                  此项仍需核实，不能直接作为淘汰依据
                </FieldLabel>
              </Field>
            </FieldSet>
          ))}
          <Button
            variant="outline"
            disabled={requirements.length >= 50}
            onClick={() =>
              setRequirements((rs) => [
                ...rs,
                {
                  key: crypto.randomUUID(),
                  kind: 'preferred',
                  text: '',
                  rationale: '',
                  needs_verification: false,
                },
              ])
            }
          >
            <Plus data-icon="inline-start" />
            添加一项要求
          </Button>
          {error && <ErrorNotice message={error} />}
          <div className="form-actions">
            <Button variant="outline" onClick={cancel}>
              取消编辑
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? '正在保存…' : '保存要求草稿'}
            </Button>
          </div>
        </FieldGroup>
      </FieldSet>
    </form>
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
