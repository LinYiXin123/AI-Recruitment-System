import Select from '@douyinfe/semi-ui/lib/es/select';
import { ChevronDown, Link2, MessageSquarePlus } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { ErrorNotice, Loading } from '@/components/feedback';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, api, dateTime } from '@/lib/api';

type EnterpriseOption = { id: number; name: string; enabled: boolean; deleted_at: string | null };
type ContentOption = {
  id: number;
  enterprise_id: number | null;
  title: string;
  category_label: string;
  updated_at: string;
};
type Category = { value: string; label: string };
type RelatedJob = {
  id: number;
  title: string;
  company_name: string;
  enterprise_id: number | null;
  enterprise_name: string;
  enterprise_enabled: boolean;
  enterprise_deleted: boolean;
  version: number;
  can_edit: boolean;
};
type Issue = {
  id: number;
  enterprise_id: number;
  enterprise_name: string;
  category: string;
  question: string;
  source_reference: string;
  status: 'pending' | 'answered' | 'closed';
  requester_id: number;
  requester_name: string;
  assignee_id: number;
  assignee_name: string;
  answer: string;
  answered_at: string | null;
  follow_up_note: string;
  closed_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  endorsement_id: number | null;
  endorsement_snapshot?: {
    title: string;
    category_label?: string;
    body?: string;
    updated_at?: string;
  } | null;
};
type Coordination = {
  current_member_id: number;
  jobs: RelatedJob[];
  assignees: { id: number; name: string }[];
  issues: Issue[];
};
type Modal =
  | {
      kind: 'create';
      requestKey: string;
      enterpriseId: string;
      category: string;
      question: string;
      assigneeId: string;
      source: string;
    }
  | { kind: 'job'; job: RelatedJob | null; enterpriseId: string }
  | {
      kind: 'answer' | 'close' | 'reassign';
      issue: Issue;
      answer: string;
      assigneeId: string;
      endorsementId: string;
      note: string;
    };

const statusLabels = { pending: '待核实', answered: '已答复待反馈', closed: '已反馈' };
const modalTitles = {
  create: '记录资料问题',
  job: '关联职位与企业',
  answer: '答复资料问题',
  close: '记录反馈结果',
  reassign: '更换负责人',
};

function sourceLink(source: string) {
  try {
    const url = new URL(source);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function EnterpriseCoordination({
  enterpriseId,
  enterprises,
  endorsements,
  categories,
  onOpenEnterprise,
}: {
  enterpriseId: number | null;
  enterprises: EnterpriseOption[];
  endorsements: ContentOption[];
  categories: readonly Category[];
  onOpenEnterprise: (id: number) => void;
}) {
  const [data, setData] = useState<Coordination | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filter, setFilter] = useState('all');
  const [modal, setModal] = useState<Modal | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [formNotice, setFormNotice] = useState('');
  const [conflict, setConflict] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const initialDraft = useRef('');
  const dirty = modal !== null && JSON.stringify(modal) !== initialDraft.current;

  const load = useCallback(async (signal?: AbortSignal) => {
    setError('');
    try {
      const next = await api<Coordination>('employer-brand/coordination/', undefined, signal);
      setData(next);
      return next;
    } catch (e) {
      if (!(e instanceof Error && e.name === 'AbortError')) setError((e as Error).message);
      return null;
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    if (modal && dialogRef.current && !dialogRef.current.open) dialogRef.current.showModal();
  }, [modal]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const activeEnterprises = enterprises.filter((item) => !item.deleted_at);
  const selectedEnterprise = activeEnterprises.find((item) => item.id === enterpriseId);
  const issues = (data?.issues ?? []).filter(
    (item) => enterpriseId === null || item.enterprise_id === enterpriseId,
  );
  const pendingMine = issues.filter(
    (item) => item.status === 'pending' && item.assignee_id === data?.current_member_id,
  );
  const feedbackMine = issues.filter(
    (item) => item.status === 'answered' && item.requester_id === data?.current_member_id,
  );
  const visibleIssues =
    filter === 'pending' ? pendingMine : filter === 'feedback' ? feedbackMine : issues;
  const relatedJobs =
    data?.jobs.filter((item) =>
      enterpriseId === null ? item.enterprise_deleted : item.enterprise_id === enterpriseId,
    ) ?? [];
  const isBusy = saving || refreshing;

  function open(next: Modal) {
    if (isBusy) return;
    initialDraft.current = JSON.stringify(next);
    setFormError('');
    setFormNotice('');
    setConflict(false);
    setModal(next);
  }

  function dismiss() {
    dialogRef.current?.close();
    setModal(null);
    setFormError('');
    setFormNotice('');
    setConflict(false);
  }

  function close() {
    if (isBusy) return;
    if (dirty && !window.confirm('有尚未保存的内容，确定放弃修改并关闭吗？')) return;
    dismiss();
  }

  function canSubmit(current: Modal) {
    if (current.kind === 'create') return true;
    if (current.kind === 'job') return !!current.job?.can_edit;
    if (current.kind === 'answer')
      return (
        current.issue.status === 'pending' && current.issue.assignee_id === data?.current_member_id
      );
    if (current.kind === 'close')
      return (
        current.issue.status === 'answered' &&
        current.issue.requester_id === data?.current_member_id
      );
    return (
      current.issue.status === 'pending' && current.issue.requester_id === data?.current_member_id
    );
  }

  async function refreshDraft() {
    if (!modal || isBusy) return;
    setRefreshing(true);
    const next = await load();
    if (next) {
      if (modal.kind === 'job') {
        const job = next.jobs.find((item) => item.id === modal.job?.id);
        if (job) setModal({ ...modal, job });
        else setFormError('当前职位已不可操作，已保留你填写的内容。');
        setConflict(!job);
      } else if (modal.kind !== 'create') {
        const issue = next.issues.find((item) => item.id === modal.issue.id);
        if (issue) setModal({ ...modal, issue });
        else setFormError('当前问题已不可访问，已保留你填写的内容。');
        setConflict(!issue);
      }
      if (
        modal.kind === 'job'
          ? next.jobs.some((item) => item.id === modal.job?.id)
          : modal.kind !== 'create' && next.issues.some((item) => item.id === modal.issue.id)
      ) {
        setFormError('');
        setFormNotice('已读取最新状态并保留草稿，请核对后再提交。');
      }
    }
    setRefreshing(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!modal || isBusy || conflict || !canSubmit(modal)) return;
    let path: string;
    let payload: Record<string, unknown>;
    if (modal.kind === 'create') {
      if (!modal.enterpriseId || !modal.assigneeId || !modal.question.trim()) {
        setFormError('请选择企业和负责人，并填写需要核实的问题。');
        return;
      }
      path = 'employer-brand/issues/';
      payload = {
        request_key: modal.requestKey,
        enterprise_id: Number(modal.enterpriseId),
        category: modal.category,
        question: modal.question.trim(),
        assignee_id: Number(modal.assigneeId),
        source_reference: modal.source.trim(),
      };
    } else if (modal.kind === 'job') {
      if (!modal.job) {
        setFormError('请选择需要关联的职位。');
        return;
      }
      path = 'employer-brand/job-enterprise/';
      payload = {
        job_id: modal.job.id,
        enterprise_id: modal.enterpriseId ? Number(modal.enterpriseId) : null,
        version: modal.job.version,
      };
    } else {
      if (modal.kind === 'answer' && !modal.answer.trim()) {
        setFormError('请填写核实后的答复。');
        return;
      }
      if (modal.kind === 'close' && !modal.note.trim()) {
        setFormError('请记录实际反馈结果。');
        return;
      }
      if (modal.kind === 'reassign' && !modal.assigneeId) {
        setFormError('请选择负责人。');
        return;
      }
      path = `employer-brand/issues/${modal.issue.id}/${modal.kind}/`;
      payload =
        modal.kind === 'answer'
          ? {
              version: modal.issue.version,
              answer: modal.answer.trim(),
              endorsement_id: modal.endorsementId ? Number(modal.endorsementId) : null,
            }
          : modal.kind === 'close'
            ? { version: modal.issue.version, follow_up_note: modal.note.trim() }
            : { version: modal.issue.version, assignee_id: Number(modal.assigneeId) };
    }
    setSaving(true);
    setFormError('');
    setFormNotice('');
    setNotice('');
    try {
      await api(path, payload);
      setNotice(
        modal.kind === 'job'
          ? '职位关联已保存。'
          : modal.kind === 'create'
            ? '资料问题已记录，可在此跟进核实与反馈。'
            : modal.kind === 'answer'
              ? '答复已保存，等待提问人记录反馈结果。'
              : modal.kind === 'close'
                ? '实际反馈结果已记录。'
                : '负责人已更换。',
      );
      dismiss();
      await load();
    } catch (e) {
      setFormError((e as Error).message);
      setConflict(e instanceof ApiError && e.status === 409);
      if (modal.kind === 'create' && e instanceof ApiError && e.status === 409) await load();
    } finally {
      setSaving(false);
    }
  }

  function openIssue(kind: 'answer' | 'close' | 'reassign', issue: Issue) {
    open({
      kind,
      issue,
      answer: '',
      assigneeId: String(issue.assignee_id),
      endorsementId: '',
      note: '',
    });
  }

  async function refresh() {
    if (isBusy) return;
    setRefreshing(true);
    const next = await load();
    if (next) setNotice('已刷新资料问题与职位关联。');
    setRefreshing(false);
  }

  if (!data)
    return (
      <section className="enterprise-coordination">
        {error ? <ErrorNotice message={error} retry={() => void load()} /> : <Loading />}
      </section>
    );

  return (
    <section className="enterprise-coordination" aria-label="企业资料协作">
      {error && <ErrorNotice message={error} retry={() => void load()} />}
      {notice && (
        <Alert>
          <AlertDescription role="status">{notice}</AlertDescription>
        </Alert>
      )}
      {(enterpriseId !== null || relatedJobs.length > 0) && (
        <details className="enterprise-coordination-panel">
          <summary>
            <span>
              <Link2 aria-hidden="true" />
              {enterpriseId === null ? '需处理的职位关联' : '关联职位'}{' '}
              <Badge variant="outline">{relatedJobs.length}</Badge>
            </span>
            <ChevronDown aria-hidden="true" />
          </summary>
          <div className="enterprise-coordination-body">
            <div className="enterprise-coordination-toolbar">
              <p>
                {enterpriseId === null
                  ? '这些职位关联的企业已删除，请重新指定企业或解除关联。'
                  : '将职位对应到企业档案，AI 初面可据此使用企业资料。'}
              </p>
              {enterpriseId !== null && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isBusy || !data.jobs.some((job) => job.can_edit)}
                  onClick={() =>
                    open({ kind: 'job', job: null, enterpriseId: String(enterpriseId) })
                  }
                >
                  关联职位
                </Button>
              )}
            </div>
            {selectedEnterprise && !selectedEnterprise.enabled && (
              <p className="enterprise-coordination-muted">
                企业已停用，职位关联可保留；该企业资料暂不用于 AI 初面。
              </p>
            )}
            {relatedJobs.length ? (
              relatedJobs.map((job) => (
                <article className="enterprise-related-job" key={job.id}>
                  <div>
                    <strong>{job.title}</strong>
                    <p>{job.company_name || '职位企业名称未填写'}</p>
                  </div>
                  {job.can_edit ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isBusy}
                      onClick={() =>
                        open({
                          kind: 'job',
                          job,
                          enterpriseId: job.enterprise_deleted
                            ? ''
                            : String(job.enterprise_id ?? ''),
                        })
                      }
                    >
                      更改关联
                    </Button>
                  ) : (
                    <span className="enterprise-coordination-muted">仅查看</span>
                  )}
                </article>
              ))
            ) : (
              <p className="enterprise-coordination-empty">还没有你可查看的关联职位。</p>
            )}
          </div>
        </details>
      )}
      <details className="enterprise-coordination-panel" open>
        <summary>
          <span>
            <MessageSquarePlus aria-hidden="true" />
            资料问题 <Badge variant="outline">{issues.length}</Badge>
          </span>
          <ChevronDown aria-hidden="true" />
        </summary>
        <div className="enterprise-coordination-body">
          <div className="enterprise-coordination-toolbar">
            <section className="enterprise-issue-filters" aria-label="资料问题筛选">
              <Button
                variant={filter === 'all' ? 'secondary' : 'ghost'}
                size="sm"
                aria-pressed={filter === 'all'}
                onClick={() => setFilter('all')}
              >
                全部问题 {issues.length}
              </Button>
              <Button
                variant={filter === 'pending' ? 'secondary' : 'ghost'}
                size="sm"
                aria-pressed={filter === 'pending'}
                onClick={() => setFilter('pending')}
              >
                待我核实 {pendingMine.length}
              </Button>
              <Button
                variant={filter === 'feedback' ? 'secondary' : 'ghost'}
                size="sm"
                aria-pressed={filter === 'feedback'}
                onClick={() => setFilter('feedback')}
              >
                待我反馈 {feedbackMine.length}
              </Button>
            </section>
            <div className="enterprise-issue-actions">
              <Button variant="ghost" size="sm" disabled={isBusy} onClick={() => void refresh()}>
                {refreshing ? '刷新中…' : '刷新'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={isBusy || !activeEnterprises.length || !data.assignees.length}
                onClick={() => {
                  const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
                  const source =
                    enterpriseId !== null && params.get('enterprise') === String(enterpriseId)
                      ? (params.get('source') ?? '')
                      : '';
                  open({
                    kind: 'create',
                    requestKey: crypto.randomUUID(),
                    enterpriseId: enterpriseId === null ? '' : String(enterpriseId),
                    category: categories[0]?.value ?? 'company_introduction',
                    question: '',
                    assigneeId: '',
                    source: source.slice(0, 500),
                  });
                }}
              >
                记录资料问题
              </Button>
            </div>
          </div>
          <p className="enterprise-coordination-muted">
            记录需核实的企业资料，由负责人答复后，再由提问人记录实际反馈结果。
          </p>
          {!activeEnterprises.length && (
            <p className="enterprise-coordination-muted">
              先创建企业档案，即可记录新问题；历史问题仍可继续处理。
            </p>
          )}
          {!data.assignees.length && (
            <p className="enterprise-coordination-muted">
              暂无可选负责人，请联系管理员检查成员权限。
            </p>
          )}
          {visibleIssues.length ? (
            <div className="enterprise-issue-list">
              {visibleIssues.map((issue) => {
                const owner = enterprises.find((item) => item.id === issue.enterprise_id);
                const linkedContent = endorsements.find((item) => item.id === issue.endorsement_id);
                const source = sourceLink(issue.source_reference);
                return (
                  <article className="enterprise-issue-card" key={issue.id}>
                    <div className="enterprise-issue-heading">
                      <div>
                        <Badge variant={issue.status === 'closed' ? 'outline' : 'secondary'}>
                          {statusLabels[issue.status]}
                        </Badge>
                        <span>
                          {categories.find((item) => item.value === issue.category)?.label ??
                            issue.category}
                        </span>
                      </div>
                      <span className="enterprise-coordination-muted">#{issue.id}</span>
                    </div>
                    <h3>{issue.question}</h3>
                    <p className="enterprise-issue-meta">
                      {issue.enterprise_name}
                      {owner?.deleted_at ? '（已删除企业）' : ''} · 提问人 {issue.requester_name} ·
                      负责人 {issue.assignee_name} · {dateTime(issue.created_at)}
                    </p>
                    <p className="enterprise-issue-source">
                      人工记录来源：
                      {source ? (
                        <a href={source} target="_blank" rel="noreferrer">
                          {issue.source_reference}
                        </a>
                      ) : (
                        issue.source_reference || '未填写'
                      )}
                    </p>
                    {issue.answer && (
                      <div className="enterprise-issue-response">
                        <strong>负责人答复</strong>
                        <p>{issue.answer}</p>
                        <span>
                          {issue.answered_at ? dateTime(issue.answered_at) : ''}
                          {issue.endorsement_id
                            ? ` · 关联资料：${issue.endorsement_snapshot?.title || linkedContent?.title || linkedContent?.category_label || `内容 #${issue.endorsement_id}`}`
                            : ''}
                        </span>
                        {issue.endorsement_snapshot && (
                          <details className="enterprise-issue-snapshot">
                            <summary>查看答复时的资料</summary>
                            <div>
                              <strong>
                                {issue.endorsement_snapshot.category_label} ·{' '}
                                {issue.endorsement_snapshot.title || '待补充'}
                              </strong>
                              <p>{issue.endorsement_snapshot.body || '该条资料未填写正文。'}</p>
                              {issue.endorsement_snapshot.updated_at && (
                                <span>
                                  资料更新时间：{dateTime(issue.endorsement_snapshot.updated_at)}
                                </span>
                              )}
                            </div>
                          </details>
                        )}
                      </div>
                    )}
                    {issue.follow_up_note && (
                      <div className="enterprise-issue-response">
                        <strong>实际反馈结果</strong>
                        <p>{issue.follow_up_note}</p>
                        <span>{issue.closed_at ? dateTime(issue.closed_at) : ''}</span>
                      </div>
                    )}
                    <div className="enterprise-issue-actions">
                      {issue.status === 'pending' &&
                        issue.assignee_id === data.current_member_id && (
                          <Button
                            size="sm"
                            disabled={isBusy}
                            onClick={() => openIssue('answer', issue)}
                          >
                            核实并答复
                          </Button>
                        )}
                      {issue.status === 'pending' &&
                        issue.requester_id === data.current_member_id && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isBusy}
                            onClick={() => openIssue('reassign', issue)}
                          >
                            更换负责人
                          </Button>
                        )}
                      {issue.status === 'answered' &&
                        issue.requester_id === data.current_member_id && (
                          <Button
                            size="sm"
                            disabled={isBusy}
                            onClick={() => openIssue('close', issue)}
                          >
                            记录反馈结果
                          </Button>
                        )}
                      {enterpriseId === null && owner && !owner.deleted_at && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onOpenEnterprise(issue.enterprise_id)}
                        >
                          查看企业资料
                        </Button>
                      )}
                      {issue.status === 'pending' &&
                        issue.assignee_id !== data.current_member_id && (
                          <span className="enterprise-coordination-muted">等待负责人核实</span>
                        )}
                      {issue.status === 'answered' &&
                        issue.requester_id !== data.current_member_id && (
                          <span className="enterprise-coordination-muted">等待提问人反馈</span>
                        )}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="enterprise-coordination-empty">
              {filter === 'pending'
                ? '暂无待你核实的问题。'
                : filter === 'feedback'
                  ? '暂无待你记录反馈的问题。'
                  : '还没有你参与的资料问题。'}
            </p>
          )}
        </div>
      </details>
      {modal && (
        <dialog
          ref={dialogRef}
          className="enterprise-dialog enterprise-coordination-dialog"
          aria-labelledby="enterprise-coordination-dialog-title"
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
        >
          <form onSubmit={(event) => void submit(event)}>
            <div className="enterprise-dialog-heading">
              <h2 id="enterprise-coordination-dialog-title">{modalTitles[modal.kind]}</h2>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="关闭"
                disabled={isBusy}
                onClick={close}
              >
                ×
              </Button>
            </div>
            <div className="enterprise-dialog-body" aria-busy={isBusy}>
              {formNotice && (
                <Alert>
                  <AlertDescription role="status">{formNotice}</AlertDescription>
                </Alert>
              )}
              {formError && (
                <p role="alert" className="enterprise-form-error">
                  {formError}
                </p>
              )}
              {conflict && modal.kind !== 'create' && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={isBusy}
                  onClick={() => void refreshDraft()}
                >
                  刷新状态并保留草稿
                </Button>
              )}
              {conflict && modal.kind === 'create' && (
                <p className="enterprise-coordination-muted">
                  本次问题可能已记录，草稿已保留。请关闭窗口核对问题列表；需要另记问题时重新新建。
                </p>
              )}
              {!canSubmit(modal) && modal.kind !== 'job' && (
                <p role="alert" className="enterprise-form-error">
                  当前状态或负责人已变化，不能继续提交此操作。你填写的内容仍保留在下方。
                </p>
              )}
              <FieldGroup>
                {(modal.kind === 'create' || modal.kind === 'job') && (
                  <Field>
                    <FieldLabel id="coord-enterprise-label" htmlFor="coord-enterprise">
                      所属企业{modal.kind === 'create' ? ' *' : ''}
                    </FieldLabel>
                    <Select
                      id="coord-enterprise"
                      aria-labelledby="coord-enterprise-label"
                      className="native-select w-full"
                      dropdownClassName="candidate-select-dropdown"
                      getPopupContainer={() => dialogRef.current ?? document.body}
                      disabled={isBusy}
                      clickToHide
                      placeholder="请选择企业"
                      value={modal.enterpriseId}
                      onChange={(value) =>
                        setModal({ ...modal, enterpriseId: String(value ?? '') })
                      }
                    >
                      {modal.kind === 'job' && <Select.Option value="">不关联企业</Select.Option>}
                      {activeEnterprises.map((item) => (
                        <Select.Option key={item.id} value={String(item.id)}>
                          {item.name}
                          {item.enabled ? '' : '（已停用）'}
                        </Select.Option>
                      ))}
                    </Select>
                    {modal.kind === 'job' && (
                      <FieldDescription>
                        选择“不关联企业”会解除该职位与企业档案的关联。
                      </FieldDescription>
                    )}
                  </Field>
                )}
                {modal.kind === 'job' && (
                  <Field>
                    <FieldLabel id="coord-job-label" htmlFor="coord-job">
                      职位 *
                    </FieldLabel>
                    <Select
                      id="coord-job"
                      aria-labelledby="coord-job-label"
                      className="native-select w-full"
                      dropdownClassName="candidate-select-dropdown"
                      getPopupContainer={() => dialogRef.current ?? document.body}
                      disabled={isBusy}
                      clickToHide
                      filter
                      placeholder="选择你有权限操作的职位"
                      value={modal.job ? String(modal.job.id) : ''}
                      onChange={(value) =>
                        setModal({
                          ...modal,
                          job: data.jobs.find((item) => String(item.id) === value) ?? null,
                        })
                      }
                    >
                      {data.jobs
                        .filter((job) => job.can_edit)
                        .map((job) => (
                          <Select.Option key={job.id} value={String(job.id)}>
                            {job.title}
                            {job.company_name ? ` · ${job.company_name}` : ''}
                          </Select.Option>
                        ))}
                    </Select>
                    <FieldDescription>
                      当前关联：{modal.job?.enterprise_name || '未关联'}
                      {modal.job?.enterprise_deleted ? '（企业已删除）' : ''}
                      。更改关联后以本次选择为准。
                    </FieldDescription>
                  </Field>
                )}
                {modal.kind === 'create' && (
                  <>
                    <Field>
                      <FieldLabel id="coord-category-label" htmlFor="coord-category">
                        资料分类 *
                      </FieldLabel>
                      <Select
                        id="coord-category"
                        aria-labelledby="coord-category-label"
                        className="native-select w-full"
                        dropdownClassName="candidate-select-dropdown"
                        getPopupContainer={() => dialogRef.current ?? document.body}
                        disabled={isBusy}
                        clickToHide
                        value={modal.category}
                        onChange={(value) => setModal({ ...modal, category: String(value) })}
                      >
                        {categories.map((category) => (
                          <Select.Option key={category.value} value={category.value}>
                            {category.label}
                          </Select.Option>
                        ))}
                      </Select>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="coord-question">需要核实的问题 *</FieldLabel>
                      <Textarea
                        id="coord-question"
                        required
                        maxLength={2000}
                        disabled={isBusy}
                        value={modal.question}
                        placeholder="写清需要核实的资料及希望负责人确认的内容"
                        onChange={(event) => setModal({ ...modal, question: event.target.value })}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="coord-source">人工来源记录（选填）</FieldLabel>
                      <Input
                        id="coord-source"
                        maxLength={500}
                        disabled={isBusy}
                        value={modal.source}
                        placeholder="飞书投递编号、链接或沟通记录"
                        onChange={(event) => setModal({ ...modal, source: event.target.value })}
                      />
                      <FieldDescription>用于人工追溯问题来源。</FieldDescription>
                    </Field>
                  </>
                )}
                {(modal.kind === 'create' || modal.kind === 'reassign') && (
                  <Field>
                    <FieldLabel id="coord-assignee-label" htmlFor="coord-assignee">
                      负责人 *
                    </FieldLabel>
                    <Select
                      id="coord-assignee"
                      aria-labelledby="coord-assignee-label"
                      className="native-select w-full"
                      dropdownClassName="candidate-select-dropdown"
                      getPopupContainer={() => dialogRef.current ?? document.body}
                      disabled={isBusy}
                      clickToHide
                      filter
                      placeholder="请选择负责核实的成员"
                      value={modal.assigneeId}
                      onChange={(value) => setModal({ ...modal, assigneeId: String(value ?? '') })}
                    >
                      {data.assignees.map((person) => (
                        <Select.Option key={person.id} value={String(person.id)}>
                          {person.name}
                        </Select.Option>
                      ))}
                    </Select>
                  </Field>
                )}
                {modal.kind !== 'create' && modal.kind !== 'job' && (
                  <div className="enterprise-issue-context">
                    <strong>
                      {modal.issue.enterprise_name} ·{' '}
                      {categories.find((item) => item.value === modal.issue.category)?.label}
                    </strong>
                    <p>{modal.issue.question}</p>
                    <span>
                      提问人 {modal.issue.requester_name} · 负责人 {modal.issue.assignee_name} ·{' '}
                      {statusLabels[modal.issue.status]}
                    </span>
                    {modal.kind === 'close' && <p>负责人答复：{modal.issue.answer}</p>}
                  </div>
                )}
                {modal.kind === 'answer' && (
                  <>
                    <Field>
                      <FieldLabel htmlFor="coord-answer">核实答复 *</FieldLabel>
                      <Textarea
                        id="coord-answer"
                        required
                        maxLength={4000}
                        disabled={isBusy}
                        value={modal.answer}
                        placeholder="说明核实结果、依据以及仍需确认的内容"
                        onChange={(event) => setModal({ ...modal, answer: event.target.value })}
                      />
                      <FieldDescription>
                        答复保留在问题记录中；企业资料需要单独编辑保存。
                      </FieldDescription>
                    </Field>
                    <Field>
                      <FieldLabel id="coord-content-label" htmlFor="coord-content">
                        关联已更新的背书内容（选填）
                      </FieldLabel>
                      <Select
                        id="coord-content"
                        aria-labelledby="coord-content-label"
                        className="native-select w-full"
                        dropdownClassName="candidate-select-dropdown"
                        getPopupContainer={() => dialogRef.current ?? document.body}
                        disabled={isBusy}
                        clickToHide
                        value={modal.endorsementId}
                        onChange={(value) =>
                          setModal({ ...modal, endorsementId: String(value ?? '') })
                        }
                      >
                        <Select.Option value="">不关联内容</Select.Option>
                        {endorsements
                          .filter((item) => item.enterprise_id === modal.issue.enterprise_id)
                          .map((item) => (
                            <Select.Option
                              key={item.id}
                              value={String(item.id)}
                              disabled={
                                Date.parse(item.updated_at) < Date.parse(modal.issue.created_at)
                              }
                            >
                              {item.category_label} · {item.title || '待补充'}
                            </Select.Option>
                          ))}
                      </Select>
                      <FieldDescription>仅可关联本问题提出后更新的背书内容。</FieldDescription>
                    </Field>
                  </>
                )}
                {modal.kind === 'close' && (
                  <Field>
                    <FieldLabel htmlFor="coord-feedback">实际反馈结果 *</FieldLabel>
                    <Textarea
                      id="coord-feedback"
                      required
                      maxLength={2000}
                      disabled={isBusy}
                      value={modal.note}
                      placeholder="记录已向谁反馈、反馈内容及后续结果"
                      onChange={(event) => setModal({ ...modal, note: event.target.value })}
                    />
                    <FieldDescription>请在实际完成反馈后记录，便于后续查阅。</FieldDescription>
                  </Field>
                )}
              </FieldGroup>
            </div>
            <div className="enterprise-dialog-footer">
              <Button type="button" variant="outline" disabled={isBusy} onClick={close}>
                取消
              </Button>
              <Button type="submit" disabled={isBusy || conflict || !canSubmit(modal)}>
                {saving
                  ? '保存中…'
                  : modal.kind === 'create'
                    ? '记录问题'
                    : modal.kind === 'answer'
                      ? '保存答复'
                      : modal.kind === 'close'
                        ? '保存反馈结果'
                        : modal.kind === 'reassign'
                          ? '保存负责人'
                          : '保存关联'}
              </Button>
            </div>
          </form>
        </dialog>
      )}
    </section>
  );
}
