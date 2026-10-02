import Select from '@douyinfe/semi-ui/lib/es/select';
import { X } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { ErrorNotice, Loading } from '@/components/feedback';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import './ai-question-selection.css';

type QuestionDraft = {
  index: number;
  content: string;
  job_title: string;
  dimension: string;
  difficulty: string;
  reference_answer: string;
  saved: boolean;
  deleted: boolean;
};
type QuestionState = {
  question_drafts: QuestionDraft[];
  saved_question_count: number;
  questions_saved: boolean;
};
const dimensions = [
  '专业能力',
  '沟通表达',
  '逻辑思维',
  '团队协作',
  '抗压能力',
  '稳定性',
  '岗位匹配度',
  '学习能力',
];

export function AiQuestionSelection({
  reportId,
  onClose,
  onSaved,
}: {
  reportId: number;
  onClose: () => void;
  onSaved: (state: QuestionState, notice: string) => void;
}) {
  const [drafts, setDrafts] = useState<QuestionDraft[]>([]);
  const [initial, setInitial] = useState<QuestionDraft[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [revision, setRevision] = useState(0);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  const chosen = drafts.filter(
    (item) => selected.includes(item.index) && !item.saved && !item.deleted,
  );
  const available = drafts.filter((item) => !item.saved && !item.deleted);
  const dirty = selected.length > 0 || JSON.stringify(drafts) !== JSON.stringify(initial);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError('');
    api<QuestionState>(`ai-screenings/${reportId}/`, undefined, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (!Array.isArray(result.question_drafts))
          throw new Error('题目草稿暂不可用，请稍后重试。');
        setDrafts(result.question_drafts);
        setInitial(result.question_drafts);
      })
      .catch((cause: Error) => {
        if (!controller.signal.aborted) setLoadError(cause.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reportId, revision]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
    headingRef.current?.focus();
  }, [preview]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function close() {
    if (busyRef.current) return;
    if (dirty && !window.confirm('尚有未入库的选择或修改，确定放弃并关闭吗？')) return;
    onClose();
  }

  function update(index: number, changes: Partial<QuestionDraft>) {
    setDrafts((current) =>
      current.map((item) => (item.index === index ? { ...item, ...changes } : item)),
    );
    setError('');
    setNotice('');
  }

  async function save() {
    if (busyRef.current || !chosen.length) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    let submitted = false;
    try {
      await api<QuestionState>(`ai-screenings/${reportId}/questions/`, {
        confirmed: true,
        questions: chosen.map(
          ({ index, content, job_title, dimension, difficulty, reference_answer }) => ({
            index,
            content,
            job_title,
            dimension,
            difficulty,
            reference_answer,
          }),
        ),
      });
      submitted = true;
      const refreshed = await api<QuestionState>(`ai-screenings/${reportId}/`);
      if (!Array.isArray(refreshed.question_drafts)) throw new Error('题目状态暂不可用。');
      const savedCount = refreshed.question_drafts.filter(
        (item) => selected.includes(item.index) && item.saved,
      ).length;
      const message = `已存入 ${savedCount} 道题。已有记录不会重复创建或覆盖；未选题目仍保留在原报告。`;
      setDrafts((current) =>
        refreshed.question_drafts.map((item) =>
          item.saved || item.deleted
            ? item
            : (current.find((draft) => draft.index === item.index) ?? item),
        ),
      );
      setInitial(refreshed.question_drafts);
      setSelected([]);
      setPreview(false);
      setNotice(message);
      onSaved(refreshed, message);
    } catch (cause) {
      setError(
        `${submitted ? '入库请求已完成，但状态未刷新，请重试核对。' : ''}${(cause as Error).message}`,
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current || !chosen.length) return;
    if (preview) {
      void save();
      return;
    }
    const empty = chosen.find((item) => !item.content.trim());
    if (empty) {
      setError(`请填写第 ${empty.index + 1} 题的题目内容。`);
      document.getElementById(`ai-draft-content-${empty.index}`)?.focus();
      return;
    }
    setDrafts((current) =>
      current.map((item) =>
        selected.includes(item.index)
          ? {
              ...item,
              content: item.content.trim(),
              job_title: item.job_title.trim(),
              reference_answer: item.reference_answer.trim(),
            }
          : item,
      ),
    );
    setError('');
    setNotice('');
    setPreview(true);
  }

  return (
    <dialog
      ref={dialogRef}
      className="enterprise-dialog ai-question-selection-dialog"
      aria-labelledby="ai-question-selection-title"
      aria-describedby="ai-question-selection-description"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <form onSubmit={submit} aria-busy={busy}>
        <div className="enterprise-dialog-heading">
          <h2 ref={headingRef} tabIndex={-1} id="ai-question-selection-title">
            {preview ? '预览入库题目' : '挑选题目入库'}
          </h2>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="关闭选题窗口"
            disabled={busy}
            onClick={close}
          >
            <X />
          </Button>
        </div>
        <div className="enterprise-dialog-body" ref={bodyRef}>
          <p id="ai-question-selection-description" className="text-sm text-muted-foreground">
            仅将勾选并确认的题目存入本组织题库；未选题目仍保留在原分析报告。请把针对个人的问题改成通用问法。
          </p>
          {loading ? (
            <Loading />
          ) : loadError ? (
            <ErrorNotice message={loadError} retry={() => setRevision((value) => value + 1)} />
          ) : (
            <>
              {notice && (
                <Alert role="status">
                  <AlertDescription>{notice}</AlertDescription>
                </Alert>
              )}
              {preview ? (
                <>
                  <Alert>
                    <AlertTitle>确认共享范围与内容</AlertTitle>
                    <AlertDescription>
                      <p>
                        存入后，本组织有题库查看权限的成员可见。请核对题目和答案中没有姓名、联系方式及可识别个人的经历细节。
                      </p>
                      <p>
                        保存时还会移除姓名、电话、邮箱等基础身份信息，以入库后的实际内容为准；仍需人工确认适合共享。
                      </p>
                    </AlertDescription>
                  </Alert>
                  {chosen.map((item) => (
                    <article
                      key={item.index}
                      className="ai-question-draft"
                      aria-label={`入库预览题目 ${item.index + 1}`}
                    >
                      <h3>第 {item.index + 1} 题</h3>
                      <p className="whitespace-pre-wrap wrap-anywhere">{item.content}</p>
                      <p className="text-sm text-muted-foreground">
                        {item.job_title || '通用职位'} · {item.dimension || '未分类'} ·{' '}
                        {item.difficulty}
                      </p>
                      <h4>参考答案要点</h4>
                      <p className="whitespace-pre-wrap wrap-anywhere">
                        {item.reference_answer || '未填写'}
                      </p>
                    </article>
                  ))}
                </>
              ) : (
                <>
                  <div className="ai-question-selection-toolbar">
                    <p>
                      已选 {chosen.length} 道 · 可选 {available.length} 道
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!available.length}
                      onClick={() => {
                        setSelected(
                          chosen.length === available.length
                            ? []
                            : available.map((item) => item.index),
                        );
                        setNotice('');
                      }}
                    >
                      {chosen.length === available.length && available.length
                        ? '取消全选'
                        : '全选未入库题目'}
                    </Button>
                  </div>
                  <FieldSet>
                    <FieldLegend className="sr-only">选择要存入题库的问题</FieldLegend>
                    {drafts.map((item) => {
                      const checked = selected.includes(item.index);
                      const locked = item.saved || item.deleted;
                      return (
                        <article
                          key={item.index}
                          className="ai-question-draft"
                          aria-label={`入库候选题目 ${item.index + 1}`}
                        >
                          <div className="ai-question-draft-heading">
                            <Field orientation="horizontal">
                              <Checkbox
                                id={`ai-draft-check-${item.index}`}
                                aria-label={`选择第 ${item.index + 1} 题`}
                                checked={checked}
                                disabled={locked}
                                onCheckedChange={(value) => {
                                  setSelected((current) =>
                                    value
                                      ? [...current, item.index]
                                      : current.filter((index) => index !== item.index),
                                  );
                                  setError('');
                                  setNotice('');
                                }}
                              />
                              <FieldLabel htmlFor={`ai-draft-check-${item.index}`}>
                                第 {item.index + 1} 题
                              </FieldLabel>
                            </Field>
                            {locked && (
                              <Badge variant="secondary">
                                {item.deleted ? '已从题库删除，不可重复入库' : '已入库'}
                              </Badge>
                            )}
                          </div>
                          {checked && !locked ? (
                            <FieldGroup>
                              <Field>
                                <FieldLabel htmlFor={`ai-draft-content-${item.index}`}>
                                  题目内容
                                </FieldLabel>
                                <Textarea
                                  id={`ai-draft-content-${item.index}`}
                                  value={item.content}
                                  maxLength={10000}
                                  required
                                  onChange={(event) =>
                                    update(item.index, { content: event.target.value })
                                  }
                                />
                              </Field>
                              <div className="ai-question-draft-classification">
                                <Field>
                                  <FieldLabel htmlFor={`ai-draft-job-${item.index}`}>
                                    适用职位
                                  </FieldLabel>
                                  <Input
                                    id={`ai-draft-job-${item.index}`}
                                    value={item.job_title}
                                    maxLength={120}
                                    placeholder="留空表示通用职位"
                                    onChange={(event) =>
                                      update(item.index, { job_title: event.target.value })
                                    }
                                  />
                                </Field>
                                <Field>
                                  <FieldLabel
                                    id={`ai-draft-dimension-label-${item.index}`}
                                    htmlFor={`ai-draft-dimension-${item.index}`}
                                  >
                                    考察维度
                                  </FieldLabel>
                                  <Select
                                    id={`ai-draft-dimension-${item.index}`}
                                    aria-labelledby={`ai-draft-dimension-label-${item.index}`}
                                    value={item.dimension || 'unclassified'}
                                    clickToHide
                                    dropdownClassName="candidate-select-dropdown"
                                    getPopupContainer={() => dialogRef.current ?? document.body}
                                    onSelect={(value) =>
                                      update(item.index, {
                                        dimension: value === 'unclassified' ? '' : String(value),
                                      })
                                    }
                                  >
                                    <Select.Option value="unclassified">未分类</Select.Option>
                                    {dimensions.map((dimension) => (
                                      <Select.Option key={dimension} value={dimension}>
                                        {dimension}
                                      </Select.Option>
                                    ))}
                                  </Select>
                                </Field>
                                <Field>
                                  <FieldLabel
                                    id={`ai-draft-difficulty-label-${item.index}`}
                                    htmlFor={`ai-draft-difficulty-${item.index}`}
                                  >
                                    难度
                                  </FieldLabel>
                                  <Select
                                    id={`ai-draft-difficulty-${item.index}`}
                                    aria-labelledby={`ai-draft-difficulty-label-${item.index}`}
                                    value={item.difficulty}
                                    clickToHide
                                    dropdownClassName="candidate-select-dropdown"
                                    getPopupContainer={() => dialogRef.current ?? document.body}
                                    onSelect={(value) =>
                                      update(item.index, { difficulty: String(value) })
                                    }
                                  >
                                    {['简单', '中等', '困难'].map((difficulty) => (
                                      <Select.Option key={difficulty} value={difficulty}>
                                        {difficulty}
                                      </Select.Option>
                                    ))}
                                  </Select>
                                </Field>
                              </div>
                              <Field>
                                <FieldLabel htmlFor={`ai-draft-answer-${item.index}`}>
                                  参考答案要点
                                </FieldLabel>
                                <Textarea
                                  id={`ai-draft-answer-${item.index}`}
                                  value={item.reference_answer}
                                  maxLength={10000}
                                  onChange={(event) =>
                                    update(item.index, { reference_answer: event.target.value })
                                  }
                                />
                              </Field>
                            </FieldGroup>
                          ) : (
                            <p className="whitespace-pre-wrap wrap-anywhere">{item.content}</p>
                          )}
                        </article>
                      );
                    })}
                  </FieldSet>
                  {!drafts.length && <p>这份分析记录没有可入库的题目。</p>}
                </>
              )}
            </>
          )}
          {error && <ErrorNotice message={error} />}
        </div>
        <div className="enterprise-dialog-footer">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={
              preview
                ? () => {
                    setPreview(false);
                    setError('');
                  }
                : close
            }
          >
            {preview ? '返回修改' : '关闭'}
          </Button>
          <Button type="submit" disabled={loading || Boolean(loadError) || !chosen.length || busy}>
            {busy
              ? '正在存入…'
              : preview
                ? `确认存入（${chosen.length} 题）`
                : `预览已选题目（${chosen.length}）`}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
