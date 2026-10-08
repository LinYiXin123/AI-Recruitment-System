import Select from '@douyinfe/semi-ui/lib/es/select';
import { Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ErrorNotice } from '@/components/feedback';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, api } from '@/lib/api';

export type ScreeningSource = {
  resume: string;
  source: {
    kind: string;
    note: string;
    filename?: string;
    parse_version?: number | null;
    edited?: boolean;
    resume_parse_id?: number | null;
  };
  job: {
    id: number;
    title: string;
    version: number;
    description: string;
    profile_version: number | null;
    profile_id?: number | null;
    requirements: { kind: string; text: string }[];
  } | null;
  application: { id: number; version: number } | null;
  captured_at: string;
};

const statuses = {
  pending: '待核实',
  supported: '人工记录：有依据支持',
  contradicted: '人工记录：与材料不符',
  unresolved: '仍待补充',
  withdrawn: '已撤回',
};
type Status = keyof typeof statuses;
export type Verification = {
  id: number;
  question_index: number;
  version: number;
  status: Status;
  answer: string;
  evidence: string;
  next_step: string;
  contact_name: string;
  due_on: string | null;
  recorder_name: string;
  created_at: string;
};
type Draft = Pick<
  Verification,
  | 'question_index'
  | 'version'
  | 'status'
  | 'answer'
  | 'evidence'
  | 'next_step'
  | 'contact_name'
  | 'due_on'
>;
type Records = { items: Verification[]; history: Verification[]; count: number; page: number };

export function ScreeningQualityNotice({
  report,
}: {
  report: { quality_version?: number; analysis_date?: string | null; analysis_issues?: string[] };
}) {
  return (
    <>
      {report.quality_version !== 2 && (
        <Alert role="status">
          <AlertTitle>旧版报告，建议重新分析</AlertTitle>
          <AlertDescription>
            原始记录已保留，未经过本轮日期、原文引用及问题关联校验。历史分数不再展示；请对照原始材料复核，不直接据此判断人选。
          </AlertDescription>
        </Alert>
      )}
      {!!report.analysis_issues?.length && (
        <Alert role="status">
          <AlertTitle>分析质量提示</AlertTitle>
          <AlertDescription>
            <p>以下问题来自模型输出，不代表候选人材料不足。</p>
            <ul className="list-disc pl-5">
              {report.analysis_issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      {report.analysis_date && (
        <p className="text-sm text-muted-foreground">日期判断基准：{report.analysis_date}</p>
      )}
    </>
  );
}

export function ScreeningSourceDetails({ source }: { source?: ScreeningSource | null }) {
  if (!source)
    return <p className="ai-screening-help">旧报告未记录分析来源版本，不能补作当时的材料依据。</p>;
  return (
    <details className="ai-report-evidence">
      <summary>本次分析依据 · {source.job?.title || '通用简历分析'}</summary>
      <p>
        材料来源：
        {source.source.kind === 'application_resume'
          ? `${source.source.filename || '已关联简历'} · 解析版本 ${source.source.parse_version}${source.source.edited ? '（基于原文人工编辑）' : ''}`
          : '手动提供文本（未关联简历版本）'}
      </p>
      {source.source.note && <p>{source.source.note}</p>}
      <p>冻结时间：{new Date(source.captured_at).toLocaleString('zh-CN')}</p>
      {source.application && (
        <p>
          应聘 #{source.application.id} · 版本 {source.application.version}
        </p>
      )}
      {source.job && (
        <>
          <p>
            职位版本 {source.job.version} ·{' '}
            {source.job.profile_version == null
              ? '未使用正式人才画像'
              : `人才画像版本 ${source.job.profile_version}`}
          </p>
          <p className="whitespace-pre-wrap">{source.job.description}</p>
          <ul>
            {source.job.requirements.map((item) => (
              <li key={`${item.kind}-${item.text}`}>
                {item.kind}：{item.text}
              </li>
            ))}
          </ul>
        </>
      )}
      <pre className="max-h-48 overflow-auto overscroll-contain whitespace-pre-wrap break-words font-sans">
        {source.resume}
      </pre>
      <p className="ai-screening-help">
        这是当时输入的快照，不代表材料已经核实，也不会随当前职位或简历变动。
      </p>
    </details>
  );
}

export function ScreeningVerification({
  reportId,
  questions,
  initial,
  disabled,
  onEditingChange,
  onRecordsChange,
  onBusyChange,
}: {
  reportId: number;
  questions: {
    question: string;
    follow_up: string;
    answer_points: string[];
    origin?: 'generated' | 'verification_fallback';
  }[];
  initial?: Verification[];
  disabled: boolean;
  onEditingChange: (editing: boolean) => void;
  onRecordsChange?: (items: Verification[]) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [items, setItems] = useState(initial || []);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [conflict, setConflict] = useState(false);
  const [revisions, setRevisions] = useState<Records | null>(null);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const retry = useRef<{ input: string; key: string } | null>(null);
  const inFlight = useRef(false);
  const active = draft !== null || busy;

  useEffect(() => setItems(initial || []), [initial]);

  function updateItems(next: Verification[]) {
    setItems(next);
    onRecordsChange?.(next);
  }
  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);

  useEffect(() => {
    onEditingChange(active);
    return () => onEditingChange(false);
  }, [active, onEditingChange]);

  useEffect(() => {
    if (!active) return;
    const currentUrl = location.href;
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    const navigation = (event: HashChangeEvent) => {
      if (location.href === currentUrl) return;
      if (inFlight.current || !window.confirm('核实内容尚未保存，确定离开并放弃编辑吗？')) {
        event.stopImmediatePropagation();
        window.history.replaceState(null, '', currentUrl);
      }
    };
    const linkNavigation = (event: MouseEvent) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
        return;
      const link =
        event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      const logout =
        event.target instanceof Element ? event.target.closest('button.sidebar-logout') : null;
      if (!link && !logout) return;
      if (link?.target === '_blank' || link?.href === currentUrl) return;
      if (inFlight.current || !window.confirm('核实内容尚未保存，确定离开并放弃编辑吗？')) {
        event.preventDefault();
        event.stopImmediatePropagation();
      } else {
        window.removeEventListener('hashchange', navigation, true);
      }
    };
    document.addEventListener('click', linkNavigation, true);
    window.addEventListener('beforeunload', unload);
    window.addEventListener('hashchange', navigation, true);
    return () => {
      window.removeEventListener('beforeunload', unload);
      window.removeEventListener('hashchange', navigation, true);
      document.removeEventListener('click', linkNavigation, true);
    };
  }, [active]);

  async function save(value: Draft) {
    if (inFlight.current || disabled) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    setConflict(false);
    const input = JSON.stringify(value);
    if (retry.current?.input !== input) retry.current = { input, key: crypto.randomUUID() };
    try {
      const result = await api<{ items: Verification[] }>(
        `ai-screenings/${reportId}/verifications/`,
        { ...value, request_key: retry.current.key },
      );
      updateItems(result.items);
      setDraft(null);
      setRevisions(null);
      retry.current = null;
      setNotice('核实记录已保存，仅保存在本报告中；未发送通知，未改变应聘阶段。');
    } catch (failure) {
      setError((failure as Error).message);
      setConflict(failure instanceof ApiError && failure.status === 409);
      setDraft(value);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function edit(index: number) {
    const existing = items.find((item) => item.question_index === index);
    setDraft({
      question_index: index,
      version: existing?.version || 0,
      status: existing?.status === 'withdrawn' ? 'pending' : existing?.status || 'pending',
      answer: existing?.answer || '',
      evidence: existing?.evidence || '',
      next_step: existing?.next_step || '',
      contact_name: existing?.contact_name || '',
      due_on: existing?.due_on || null,
    });
    setError('');
    setNotice('');
    setRevisions(null);
    retry.current = null;
  }

  async function history(index: number, page = 1) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await api<Records>(
        `ai-screenings/${reportId}/verifications/?question_index=${index}&page=${page}`,
      );
      updateItems(result.items);
      setRevisions(result);
      setHistoryIndex(index);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function copy() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const latest = await api<Records>(`ai-screenings/${reportId}/verifications/`);
      updateItems(latest.items);
      const selected = latest.items.filter((item) => item.status !== 'withdrawn');
      const text = [
        `AI 初面报告 #${reportId} · HR 手动核实提纲（未发送通知，不代替正式面评）`,
        ...selected.map((item) => {
          const question = questions[item.question_index];
          return [
            `第 ${item.question_index + 1} 题：${question.question}`,
            `追问：${question.follow_up}`,
            `合格回答要点：${question.answer_points.join('；')}`,
            `人工记录状态：${statuses[item.status]}`,
            `实际回答：${item.answer || '未记录'}`,
            `核实依据：${item.evidence || '未记录'}`,
            `下一步：${item.next_step || '未记录'}`,
            `手动对接人：${item.contact_name || '未记录'} · 日期：${item.due_on || '未定'}`,
          ].join('\n');
        }),
      ].join('\n\n');
      await navigator.clipboard.writeText(text);
      setNotice('已复制已采用题目及核实记录，请确认收件权限后手动交接；未发送通知。');
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : '复制未成功，请手动选中记录复制。');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function loadLatest() {
    if (!draft || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const latest = await api<Records>(`ai-screenings/${reportId}/verifications/`);
      updateItems(latest.items);
      setDraft({
        ...draft,
        version:
          latest.items.find((item) => item.question_index === draft.question_index)?.version || 0,
      });
      retry.current = null;
      setConflict(false);
      setError('');
      setNotice('最新已保存记录显示在上方，你填写的内容仍在下方。请对照确认后再保存。');
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="ai-verification-title" className="grid gap-3">
      <h3 id="ai-verification-title">人工核实</h3>
      <p className="ai-screening-help">
        由报告创建者记录实际回答与依据，仅本人可见；不是正式面评，不自动推进招聘或同步飞书。手动对接人仅用于备忘，未发送通知。
      </p>
      <p className="ai-screening-help">
        已采用 {items.filter((item) => item.status !== 'withdrawn').length} / {questions.length} 题
        · 待核实{' '}
        {items.filter((item) => item.status === 'pending' || item.status === 'unresolved').length}{' '}
        题
      </p>
      {questions.map((question, index) => {
        const item = items.find((record) => record.question_index === index);
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: 报告的问题列表冻结，索引即服务端核实记录的题目键。
          <div className="grid gap-2 rounded-lg border p-3" key={index}>
            <p>
              第 {index + 1} 题 · {question.question}
            </p>
            {question.origin === 'verification_fallback' && (
              <Badge variant="outline">系统补齐的核实题</Badge>
            )}
            <Badge variant="secondary">{item ? statuses[item.status] : '未采用'}</Badge>
            {item && (
              <>
                {item.answer && <p className="whitespace-pre-wrap">实际回答：{item.answer}</p>}
                {item.evidence && <p className="whitespace-pre-wrap">核实依据：{item.evidence}</p>}
                {item.next_step && <p className="whitespace-pre-wrap">下一步：{item.next_step}</p>}
                <p className="ai-screening-help">
                  {item.recorder_name} · 第 {item.version} 版 ·{' '}
                  {new Date(item.created_at).toLocaleString('zh-CN')}
                </p>
                {(item.contact_name || item.due_on) && (
                  <p className="ai-screening-help">
                    手动对接人：{item.contact_name || '未填写'} · 日期：{item.due_on || '未定'}
                    （未通知）
                  </p>
                )}
              </>
            )}
            <div className="flex flex-wrap gap-2">
              {item ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={disabled || active}
                  onClick={() => edit(index)}
                >
                  {item.status === 'withdrawn' ? '重新采用' : '记录核实'}
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={disabled || active}
                  onClick={() =>
                    void save({
                      question_index: index,
                      version: 0,
                      status: 'pending',
                      answer: '',
                      evidence: '',
                      next_step: '',
                      contact_name: '',
                      due_on: null,
                    })
                  }
                >
                  加入待核实
                </Button>
              )}
              {item && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={disabled || active}
                  onClick={() => void history(index)}
                >
                  修订历史
                </Button>
              )}
            </div>
          </div>
        );
      })}
      {draft && (
        <form
          className="grid gap-3 rounded-lg border p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save(draft);
          }}
        >
          <h4>记录第 {draft.question_index + 1} 题的核实结果</h4>
          <p className="ai-screening-help">{questions[draft.question_index].question}</p>
          <FieldGroup>
            <Field>
              <FieldLabel id="verification-status-label" htmlFor="verification-status">
                核实状态
              </FieldLabel>
              <Select
                id="verification-status"
                aria-labelledby="verification-status-label"
                className="ai-screening-select"
                dropdownClassName="candidate-select-dropdown"
                value={draft.status}
                disabled={busy || disabled}
                onChange={(value) => setDraft({ ...draft, status: value as Status })}
              >
                {Object.entries(statuses)
                  .filter(([status]) => draft.version > 0 || status !== 'withdrawn')
                  .map(([status, label]) => (
                    <Select.Option key={status} value={status}>
                      {label}
                    </Select.Option>
                  ))}
              </Select>
            </Field>
            {(['answer', 'evidence', 'next_step'] as const).map((key) => (
              <Field key={key}>
                <FieldLabel htmlFor={`verification-${key}`}>
                  {key === 'next_step' && draft.status === 'withdrawn'
                    ? '撤回原因'
                    : { answer: '实际回答', evidence: '核实材料或依据', next_step: '下一步' }[key]}
                </FieldLabel>
                <Textarea
                  id={`verification-${key}`}
                  className="h-24 resize-none overflow-auto field-sizing-fixed"
                  disabled={busy || disabled}
                  maxLength={{ answer: 5000, evidence: 3000, next_step: 1000 }[key]}
                  value={draft[key]}
                  required={
                    (key !== 'next_step' && ['supported', 'contradicted'].includes(draft.status)) ||
                    (key === 'next_step' && ['unresolved', 'withdrawn'].includes(draft.status))
                  }
                  onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
                />
              </Field>
            ))}
            <Field>
              <FieldLabel htmlFor="verification-contact">手动对接人（未通知）</FieldLabel>
              <Input
                id="verification-contact"
                maxLength={100}
                value={draft.contact_name}
                required={draft.status === 'unresolved'}
                disabled={busy || disabled}
                onChange={(event) => setDraft({ ...draft, contact_name: event.target.value })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="verification-due">跟进日期</FieldLabel>
              <Input
                id="verification-due"
                type="date"
                value={draft.due_on || ''}
                disabled={busy || disabled}
                onChange={(event) => setDraft({ ...draft, due_on: event.target.value || null })}
              />
            </Field>
          </FieldGroup>
          <p className="ai-screening-help">
            每次保存新增修订，不覆盖 AI 原文。编辑期间已暂停切换报告与修改分析输入。
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy || disabled}>
              {busy ? '正在保存…' : '保存核实记录'}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                if (window.confirm('放弃尚未保存的核实内容？')) {
                  setDraft(null);
                  setError('');
                  retry.current = null;
                }
              }}
            >
              取消编辑
            </Button>
          </div>
        </form>
      )}
      {error && <ErrorNotice message={error} />}
      {conflict && draft && (
        <Button type="button" variant="outline" disabled={busy} onClick={() => void loadLatest()}>
          读取最新版本（保留输入）
        </Button>
      )}
      {notice && (
        <p role="status" className="ai-screening-notice">
          {notice}
        </p>
      )}
      {revisions && historyIndex !== null && (
        <section className="grid gap-2 rounded-lg border p-3" aria-label="核实修订历史">
          <h4>第 {historyIndex + 1} 题 · 修订历史</h4>
          {revisions.history.map((item) => (
            <div key={item.id} className="grid gap-1 border-b pb-2">
              <p>
                第 {item.version} 版 · {statuses[item.status]} · {item.recorder_name}
              </p>
              <p className="ai-screening-help">
                {new Date(item.created_at).toLocaleString('zh-CN')}
              </p>
              <p className="whitespace-pre-wrap">
                回答：{item.answer || '未记录'}
                <br />
                依据：{item.evidence || '未记录'}
                <br />
                下一步：{item.next_step || '未记录'}
              </p>
              <p>
                手动对接人：{item.contact_name || '未填写'} · {item.due_on || '未定日期'}（未通知）
              </p>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={active || revisions.page <= 1}
              onClick={() => void history(historyIndex, revisions.page - 1)}
            >
              上一页
            </Button>
            <span>
              第 {revisions.page} 页 · 共 {revisions.count} 次修订
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={active || revisions.page * 10 >= revisions.count}
              onClick={() => void history(historyIndex, revisions.page + 1)}
            >
              下一页
            </Button>
          </div>
        </section>
      )}
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={disabled || active || !items.some((item) => item.status !== 'withdrawn')}
        onClick={() => void copy()}
      >
        <Copy data-icon="inline-start" />
        复制核实提纲
      </Button>
    </section>
  );
}
