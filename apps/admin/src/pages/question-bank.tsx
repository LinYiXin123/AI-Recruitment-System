import AutoComplete from '@douyinfe/semi-ui/lib/es/autoComplete';
import Select from '@douyinfe/semi-ui/lib/es/select';
import { ChevronDown, Download, Inbox, Plus, Search, X } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { ErrorNotice, Loading, Pager } from '@/components/feedback';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, api, downloadApi } from '@/lib/api';
import { type GuideEntry, QuestionGuide } from './question-guide';
import './question-bank.css';

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
const difficulties = ['简单', '中等', '困难'];
type QuestionDraft = {
  content: string;
  job_title: string;
  dimension: string;
  difficulty: string;
  reference_answer: string;
};
type Question = QuestionDraft & { id: number; version: number };
type QuestionList = {
  items: Question[];
  count: number;
  can_manage: boolean;
  job_titles: string[];
};
type QuestionModal = {
  question?: Question;
  draft: QuestionDraft;
  initial: QuestionDraft;
  request_key: string;
  readOnly: boolean;
  isCopy: boolean;
};
const emptyFilters = { q: '', job_title: '', dimension: '', difficulty: '' };

export function QuestionBank() {
  const [data, setData] = useState<QuestionList | null>(null);
  const [filters, setFilters] = useState(emptyFilters);
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [modal, setModal] = useState<QuestionModal | null>(null);
  const [formError, setFormError] = useState('');
  const [formNotice, setFormNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [guideEntries, setGuideEntries] = useState<GuideEntry[]>([]);
  const [guideOpen, setGuideOpen] = useState(false);
  const hasGuide = guideEntries.length > 0;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const busyRef = useRef(false);
  const modalRequestKey = modal?.request_key;
  const dirty =
    modal !== null &&
    (modal.isCopy || JSON.stringify(modal.draft) !== JSON.stringify(modal.initial));

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError('');
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ ...filters, q: filters.q.trim(), page: String(page) });
        const result = await api<QuestionList>(
          `question-templates/?${params}`,
          undefined,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        const lastPage = Math.max(1, Math.ceil(result.count / 20));
        if (page > lastPage) {
          setPage(lastPage);
          return;
        }
        setData(result);
      } catch (error) {
        if (
          !controller.signal.aborted &&
          error instanceof ApiError &&
          error.status === 404 &&
          page > 1
        ) {
          setPage(1);
          return;
        }
        if (!controller.signal.aborted) setLoadError((error as Error).message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [filters, page, revision]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (modal && dialog && !dialog.open) dialog.showModal();
    if (!modal && dialog?.open) dialog.close();
  }, [modal]);

  useEffect(() => {
    if (modalRequestKey) contentRef.current?.focus();
  }, [modalRequestKey]);

  useEffect(() => {
    if (!dirty && !hasGuide) return;
    const preventUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', preventUnload);
    return () => window.removeEventListener('beforeunload', preventUnload);
  }, [dirty, hasGuide]);

  function changeFilter(key: keyof typeof filters, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  }

  function openQuestion(question?: Question, mode: 'edit' | 'view' | 'copy' = 'edit') {
    const draft: QuestionDraft = {
      content: question?.content ?? '',
      job_title: question?.job_title ?? '',
      dimension: question?.dimension ?? '',
      difficulty: question?.difficulty ?? '中等',
      reference_answer: question?.reference_answer ?? '',
    };
    setFormError('');
    setFormNotice('');
    setModal({
      question: mode === 'copy' ? undefined : question,
      draft,
      initial: draft,
      request_key: crypto.randomUUID(),
      readOnly: mode === 'view',
      isCopy: mode === 'copy',
    });
  }

  function closeModal() {
    if (busyRef.current) return;
    if (dirty && !window.confirm('题目尚未保存，确定放弃本次修改吗？')) return;
    setModal(null);
    setFormError('');
  }

  function changeDraft(key: keyof QuestionDraft, value: string) {
    setModal((current) =>
      current ? { ...current, draft: { ...current.draft, [key]: value } } : current,
    );
  }

  async function saveQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!modal || modal.readOnly || !data?.can_manage || busyRef.current) return;
    const continueAdding =
      !modal.question &&
      (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'continue';
    if (!modal.draft.content.trim()) {
      setFormError('请填写题目内容。');
      return;
    }
    busyRef.current = true;
    setBusy('save');
    setFormError('');
    setFormNotice('');
    setActionError('');
    setNotice('');
    try {
      const draft = {
        ...modal.draft,
        content: modal.draft.content.trim(),
        job_title: modal.draft.job_title.trim(),
        reference_answer: modal.draft.reference_answer.trim(),
      };
      if (modal.question) {
        await api(
          `question-templates/${modal.question.id}/`,
          { ...draft, version: modal.question.version },
          undefined,
          'PATCH',
        );
      } else {
        await api('question-templates/', { ...draft, request_key: modal.request_key });
        setFilters(emptyFilters);
        setPage(1);
      }
      setNotice(modal.question ? '题目已更新。' : '题目已新增。');
      if (continueAdding) {
        const nextDraft = { ...draft, content: '', reference_answer: '' };
        setModal({
          draft: nextDraft,
          initial: nextDraft,
          request_key: crypto.randomUUID(),
          readOnly: false,
          isCopy: false,
        });
        setFormNotice('题目已保存，可以继续录入下一题。');
      } else {
        setModal(null);
      }
      setRevision((current) => current + 1);
    } catch (error) {
      setFormError((error as Error).message);
    } finally {
      busyRef.current = false;
      setBusy('');
    }
  }

  async function deleteQuestion(question: Question) {
    if (!data?.can_manage || busyRef.current) return;
    if (!window.confirm(`确定删除题目“${question.content.slice(0, 70)}”吗？题目将移出当前题库。`))
      return;
    busyRef.current = true;
    setBusy(`delete-${question.id}`);
    setActionError('');
    setNotice('');
    try {
      await api(
        `question-templates/${question.id}/`,
        { version: question.version },
        undefined,
        'DELETE',
      );
      setNotice('题目已删除。');
      setGuideEntries((current) => current.filter((entry) => entry.id !== question.id));
      setRevision((current) => current + 1);
    } catch (error) {
      setActionError((error as Error).message);
    } finally {
      busyRef.current = false;
      setBusy('');
    }
  }

  async function exportModule(filtered = false) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(filtered ? 'export-filtered' : 'export');
    setActionError('');
    setNotice('');
    try {
      const query = filtered ? `?${new URLSearchParams({ ...filters, q: filters.q.trim() })}` : '';
      await downloadApi(
        `question-templates/export/${query}`,
        filtered ? '面试题库-筛选结果.csv' : '面试题库.csv',
      );
      setNotice(filtered ? '已导出所有符合当前筛选条件的题目。' : '已导出当前可访问的全部题目。');
    } catch (error) {
      setActionError((error as Error).message);
    } finally {
      busyRef.current = false;
      setBusy('');
    }
  }

  const hasFilters = Object.values(filters).some((value) => value.trim());
  const selectedIds = new Set(guideEntries.map((entry) => entry.id));
  const selectedOnPage = data?.items.filter((question) => selectedIds.has(question.id)).length ?? 0;
  const filterOptions = [
    {
      key: 'job_title',
      label: '适用职位筛选',
      allLabel: '全部职位',
      options: data?.job_titles ?? [],
    },
    { key: 'dimension', label: '考察维度筛选', allLabel: '全部维度', options: dimensions },
    { key: 'difficulty', label: '难度筛选', allLabel: '全部难度', options: difficulties },
  ] as const;

  return (
    <section className="question-bank" aria-label="面试题库">
      <div className="page-heading">
        <div>
          <h1>面试题库</h1>
          <p>按职位与考察维度分类管理</p>
        </div>
        <div className="page-actions">
          <Button
            variant="outline"
            disabled={!hasGuide || !!busy}
            onClick={() => setGuideOpen(true)}
          >
            整理面试提纲（{guideEntries.length}）
          </Button>
          <Button
            variant="outline"
            disabled={!data || !!busy}
            title="导出当前可访问的全部题目，不受当前筛选和分页影响"
            onClick={() => void exportModule()}
          >
            <Download data-icon="inline-start" />
            {busy === 'export' ? '导出中…' : '导出全部'}
          </Button>
          {hasFilters && (
            <Button
              variant="outline"
              disabled={!data || loading || !!loadError || !!busy}
              onClick={() => void exportModule(true)}
            >
              <Download data-icon="inline-start" />
              {busy === 'export-filtered' ? '导出中…' : '导出筛选结果'}
            </Button>
          )}
          {data?.can_manage && (
            <Button disabled={!!busy} onClick={() => openQuestion()}>
              <Plus data-icon="inline-start" />
              新增题目
            </Button>
          )}
        </div>
      </div>

      {notice && (
        <p className="question-bank-notice" role="status">
          {notice}
        </p>
      )}
      {actionError && <ErrorNotice message={actionError} />}
      {hasGuide && (
        <div className="question-bank-selection">
          <span>已选 {guideEntries.length} 题，切换筛选和分页后保留。</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (window.confirm('确定清空已选题目和临时追问吗？')) setGuideEntries([]);
            }}
          >
            清空选择
          </Button>
        </div>
      )}
      <div className="question-bank-panel">
        <div className="question-bank-filters">
          <div className="question-bank-search">
            <Search aria-hidden="true" />
            <Input
              aria-label="搜索题目"
              placeholder="搜索…"
              type="search"
              maxLength={200}
              value={filters.q}
              onChange={(event) => changeFilter('q', event.target.value)}
            />
          </div>
          {filterOptions.map(({ key, label, allLabel, options }) => (
            <div className="question-bank-filter" key={key}>
              <span className="sr-only" id={`question-filter-${key}`}>
                {label}
              </span>
              <Select
                className="native-select w-full"
                dropdownClassName="candidate-select-dropdown"
                aria-labelledby={`question-filter-${key}`}
                value={filters[key]}
                clickToHide
                optionList={[
                  { value: '', label: allLabel },
                  ...options.map((value) => ({ value, label: value })),
                ]}
                onSelect={(value) => changeFilter(key, typeof value === 'string' ? value : '')}
              />
            </div>
          ))}
          <Button
            variant="outline"
            className="question-bank-reset"
            onClick={() => {
              setFilters(emptyFilters);
              setPage(1);
            }}
          >
            重置
          </Button>
        </div>

        {loading ? (
          <Loading />
        ) : loadError ? (
          <div className="question-bank-load-error">
            <ErrorNotice message={loadError} retry={() => setRevision((current) => current + 1)} />
          </div>
        ) : data?.items.length ? (
          <>
            <div className="question-bank-table-scroll">
              <table className="question-bank-table">
                <caption className="sr-only">面试题库题目列表</caption>
                <thead>
                  <tr>
                    <th scope="col" className="question-bank-select-column">
                      <Checkbox
                        aria-label="全选本页题目"
                        checked={selectedOnPage === data.items.length}
                        indeterminate={selectedOnPage > 0 && selectedOnPage < data.items.length}
                        onCheckedChange={(checked) =>
                          setGuideEntries((current) =>
                            checked
                              ? [
                                  ...current,
                                  ...data.items
                                    .filter((question) => !selectedIds.has(question.id))
                                    .map((question) => ({ ...question, follow_up: '' })),
                                ]
                              : current.filter(
                                  (entry) =>
                                    !data.items.some((question) => question.id === entry.id),
                                ),
                          )
                        }
                      />
                    </th>
                    <th scope="col">题目内容</th>
                    <th scope="col">适用职位</th>
                    <th scope="col">考察维度</th>
                    <th scope="col">难度</th>
                    <th scope="col">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((question) => (
                    <tr key={question.id}>
                      <td className="question-bank-select-column">
                        <Checkbox
                          aria-label={`选择题目：${question.content}`}
                          checked={selectedIds.has(question.id)}
                          onCheckedChange={(checked) =>
                            setGuideEntries((current) =>
                              checked
                                ? [...current, { ...question, follow_up: '' }]
                                : current.filter((entry) => entry.id !== question.id),
                            )
                          }
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="question-bank-question"
                          onClick={() => openQuestion(question, 'view')}
                        >
                          {question.content}
                        </button>
                        <span className="question-bank-answer-preview">
                          {question.reference_answer || '暂未填写参考答案'}
                        </span>
                      </td>
                      <td>{question.job_title || '通用'}</td>
                      <td>{question.dimension || '未分类'}</td>
                      <td>
                        <Badge variant="outline">{question.difficulty}</Badge>
                      </td>
                      <td>
                        <div className="question-bank-row-actions">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => openQuestion(question, 'view')}
                          >
                            查看
                          </Button>
                          {data.can_manage && (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={!!busy}
                                onClick={() => openQuestion(question)}
                              >
                                编辑
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={!!busy}
                                onClick={() => openQuestion(question, 'copy')}
                              >
                                复制
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                disabled={!!busy}
                                onClick={() => void deleteQuestion(question)}
                              >
                                {busy === `delete-${question.id}` ? '删除中…' : '删除'}
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={page} count={data.count} onChange={setPage} />
          </>
        ) : (
          <Empty className="question-bank-empty">
            <EmptyHeader>
              <EmptyMedia>
                <Inbox className="question-bank-empty-icon" aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>{hasFilters ? '没有符合条件的题目' : '还没有数据'}</EmptyTitle>
              <EmptyDescription>
                {hasFilters
                  ? '试试调整关键词或筛选条件。'
                  : data?.can_manage
                    ? '点击右上角「新增题目」开始录入第一条'
                    : 'HR 或招聘主管添加题目后，将在这里展示。'}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>

      <QuestionGuide
        open={guideOpen}
        entries={guideEntries}
        setEntries={setGuideEntries}
        onClose={() => setGuideOpen(false)}
      />
      <dialog
        ref={dialogRef}
        className="question-bank-dialog"
        aria-labelledby="question-dialog-title"
        onCancel={(event) => {
          event.preventDefault();
          closeModal();
        }}
      >
        {modal && (
          <form onSubmit={(event) => void saveQuestion(event)}>
            <div className="question-bank-dialog-heading">
              <h2 id="question-dialog-title">
                {modal.readOnly
                  ? '查看题目'
                  : modal.question
                    ? '编辑题目'
                    : modal.isCopy
                      ? '复制题目'
                      : '新增题目'}
              </h2>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="关闭"
                disabled={busy === 'save'}
                onClick={closeModal}
              >
                <X />
              </Button>
            </div>
            <div className="question-bank-dialog-body">
              {formNotice && (
                <p className="question-bank-form-notice" role="status">
                  {formNotice}
                </p>
              )}
              {formError && (
                <Alert variant="destructive">
                  <AlertDescription>{formError}</AlertDescription>
                </Alert>
              )}
              {modal.readOnly ? (
                <dl className="question-bank-details">
                  <div>
                    <dt>题目内容</dt>
                    <dd>{modal.draft.content}</dd>
                  </div>
                  <div className="question-bank-detail-meta">
                    <div>
                      <dt>适用职位</dt>
                      <dd>{modal.draft.job_title || '通用'}</dd>
                    </div>
                    <div>
                      <dt>考察维度</dt>
                      <dd>{modal.draft.dimension || '未分类'}</dd>
                    </div>
                    <div>
                      <dt>难度</dt>
                      <dd>{modal.draft.difficulty}</dd>
                    </div>
                  </div>
                  <div>
                    <dt>参考答案要点</dt>
                    <dd>{modal.draft.reference_answer || '暂未填写参考答案'}</dd>
                  </div>
                </dl>
              ) : (
                <fieldset disabled={busy === 'save'}>
                  <FieldGroup>
                    <Field data-invalid={(!!formError && !modal.draft.content.trim()) || undefined}>
                      <FieldLabel htmlFor="question-content">
                        题目内容 <span className="question-bank-required">*</span>
                      </FieldLabel>
                      <Textarea
                        ref={contentRef}
                        id="question-content"
                        required
                        autoFocus
                        maxLength={10000}
                        value={modal.draft.content}
                        aria-invalid={(!!formError && !modal.draft.content.trim()) || undefined}
                        onChange={(event) => changeDraft('content', event.target.value)}
                      />
                    </Field>
                    <div className="question-bank-form-columns">
                      <Field>
                        <FieldLabel htmlFor="question-job-title">适用职位</FieldLabel>
                        <AutoComplete
                          className="question-bank-job-title"
                          dropdownClassName="question-bank-job-options"
                          data={(data?.job_titles ?? []).filter((title) =>
                            title
                              .toLocaleLowerCase()
                              .includes(modal.draft.job_title.trim().toLocaleLowerCase()),
                          )}
                          value={modal.draft.job_title}
                          disabled={busy === 'save'}
                          maxHeight={220}
                          getPopupContainer={() => dialogRef.current ?? document.body}
                          onChange={(value) =>
                            changeDraft('job_title', String(value).slice(0, 120))
                          }
                          triggerRender={({ inputValue, onChange, onFocus, onBlur }) => (
                            <div className="question-bank-job-input">
                              <Input
                                id="question-job-title"
                                maxLength={120}
                                placeholder="填写或选择已有职位"
                                disabled={busy === 'save'}
                                value={inputValue}
                                onChange={(event) => onChange(event.target.value)}
                                onFocus={onFocus}
                                onBlur={onBlur}
                              />
                              <ChevronDown aria-hidden="true" />
                            </div>
                          )}
                        />
                      </Field>
                      <Field>
                        <FieldLabel id="question-dimension-label" htmlFor="question-dimension">
                          考察维度
                        </FieldLabel>
                        <Select
                          id="question-dimension"
                          aria-labelledby="question-dimension-label"
                          className="native-select w-full"
                          dropdownClassName="candidate-select-dropdown"
                          value={modal.draft.dimension}
                          disabled={busy === 'save'}
                          clickToHide
                          maxHeight={220}
                          getPopupContainer={() => dialogRef.current ?? document.body}
                          optionList={[
                            { value: '', label: '请选择' },
                            ...dimensions.map((value) => ({ value, label: value })),
                          ]}
                          onSelect={(value) =>
                            changeDraft('dimension', typeof value === 'string' ? value : '')
                          }
                        />
                      </Field>
                      <Field>
                        <FieldLabel id="question-difficulty-label" htmlFor="question-difficulty">
                          难度
                        </FieldLabel>
                        <Select
                          id="question-difficulty"
                          aria-labelledby="question-difficulty-label"
                          className="native-select w-full"
                          dropdownClassName="candidate-select-dropdown"
                          value={modal.draft.difficulty}
                          disabled={busy === 'save'}
                          clickToHide
                          getPopupContainer={() => dialogRef.current ?? document.body}
                          optionList={difficulties.map((value) => ({ value, label: value }))}
                          onSelect={(value) =>
                            changeDraft('difficulty', typeof value === 'string' ? value : '中等')
                          }
                        />
                      </Field>
                    </div>
                    <Field>
                      <FieldLabel htmlFor="question-reference-answer">参考答案要点</FieldLabel>
                      <Textarea
                        id="question-reference-answer"
                        maxLength={10000}
                        value={modal.draft.reference_answer}
                        onChange={(event) => changeDraft('reference_answer', event.target.value)}
                      />
                    </Field>
                  </FieldGroup>
                </fieldset>
              )}
            </div>
            <div className="question-bank-dialog-footer">
              <Button
                type="button"
                variant="outline"
                disabled={busy === 'save'}
                onClick={closeModal}
              >
                {modal.readOnly ? '关闭' : '取消'}
              </Button>
              {!modal.readOnly && (
                <Button type="submit" disabled={busy === 'save'}>
                  {busy === 'save' ? '保存中…' : '保存'}
                </Button>
              )}
              {!modal.readOnly && !modal.question && (
                <Button type="submit" variant="outline" value="continue" disabled={busy === 'save'}>
                  保存并继续
                </Button>
              )}
            </div>
          </form>
        )}
      </dialog>
    </section>
  );
}
