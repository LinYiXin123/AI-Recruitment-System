import Progress from '@douyinfe/semi-ui/lib/es/progress';
import Select from '@douyinfe/semi-ui/lib/es/select';
import { Bot, Copy, Crosshair, RotateCcw, Sparkles, Trash2, Upload } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
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
import { api, type Job, type Page } from '@/lib/api';
import type { Application } from '@/lib/intake';

type ApplicationOption = Pick<Application, 'id' | 'candidate' | 'name'>;
type JobOption = Pick<Job, 'id' | 'title'>;
type EnterpriseOption = { id: number; name: string; industry: string };
type CandidateOption = { id: number; name: string; applicationId: number };
type ScreeningResult = {
  id?: number;
  code?: string;
  created_at?: string;
  candidate_name?: string;
  job_title?: string;
  enterprise_name?: string;
  saved_question_count?: number;
  match_score?: number | null;
  conclusion?: string;
  follow_up_direction?: string;
  summary: string;
  evidence: { criterion: string; quote: string; reason: string }[];
  gaps: { criterion: string; note: string }[];
  questions: {
    question: string;
    reason: string;
    follow_up: string;
    answer_points: string[];
    quote: string;
  }[];
  limitations: string;
};
type ScreeningHistory = {
  id: number;
  code: string;
  candidate_name: string;
  job_title: string;
  enterprise_name: string;
  conclusion: string;
  match_score: number | null;
  created_at: string;
  question_count: number;
};
type HistoryPage = { items: ScreeningHistory[]; count: number; page: number; page_size: number };

function analysisTime(value?: string) {
  if (!value) return '—';
  return new Date(value).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function safeResumeUrl(value: string) {
  const href = value.trim();
  if (!/^(https?:\/\/|mailto:)/i.test(href)) return '';
  try {
    const url = new URL(href);
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function linkifyResumeText(text: string) {
  const fragment = document.createDocumentFragment();
  const urls =
    /(?<![\w@.-])(?:https?:\/\/|www\.)[^\s<>"']+|(?<![\w@.-])(?:[\w-]+\.)+[a-z]{2,}(?:\/[^\s<>"']*)?/gi;
  let offset = 0;
  for (const match of text.matchAll(urls)) {
    const index = match.index ?? 0;
    const raw = match[0];
    const url = raw.replace(/[.,;:!?，。；：！？)\]}）】]+$/u, '');
    if (!url) continue;
    fragment.append(document.createTextNode(text.slice(offset, index)));
    const href = safeResumeUrl(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    if (href) {
      const link = document.createElement('a');
      link.href = href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = url;
      fragment.append(link);
    } else {
      fragment.append(document.createTextNode(url));
    }
    fragment.append(document.createTextNode(raw.slice(url.length)));
    offset = index + raw.length;
  }
  fragment.append(document.createTextNode(text.slice(offset)));
  return fragment;
}

function sanitizeResumeMarkup(markup: string) {
  const parsed = new DOMParser().parseFromString(markup, 'text/html');
  const safe = document.createElement('div');
  const allowed = new Set(['a', 'b', 'br', 'div', 'em', 'i', 'li', 'ol', 'p', 'strong', 'u', 'ul']);
  const blocked = new Set(['iframe', 'object', 'script', 'style', 'svg']);
  const copy = (node: Node, parent: HTMLElement, insideLink = false) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? '';
      parent.append(insideLink ? document.createTextNode(text) : linkifyResumeText(text));
      return;
    }
    if (!(node instanceof HTMLElement) || blocked.has(node.tagName.toLowerCase())) return;
    const tag = node.tagName.toLowerCase();
    if (!allowed.has(tag)) {
      for (const child of Array.from(node.childNodes)) copy(child, parent, insideLink);
      return;
    }
    if (tag === 'a') {
      const href = safeResumeUrl(node.getAttribute('href') ?? '');
      if (!href) {
        for (const child of Array.from(node.childNodes)) copy(child, parent, insideLink);
        return;
      }
      const link = document.createElement('a');
      link.href = href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      for (const child of Array.from(node.childNodes)) copy(child, link, true);
      parent.append(link);
      return;
    }
    const element = document.createElement(tag);
    for (const child of Array.from(node.childNodes)) copy(child, element, insideLink);
    parent.append(element);
  };
  for (const child of Array.from(parsed.body.childNodes)) copy(child, safe);
  return safe.innerHTML;
}

function resumeTextFromEditor(editor: HTMLElement) {
  const copy = editor.cloneNode(true) as HTMLElement;
  for (const link of Array.from(copy.querySelectorAll('a[href]'))) {
    const href = link.getAttribute('href') ?? '';
    if (href && !link.textContent?.includes(href)) {
      link.append(document.createTextNode(` (${href})`));
    }
  }
  for (const lineBreak of Array.from(copy.querySelectorAll('br'))) lineBreak.replaceWith('\n');
  for (const block of Array.from(copy.querySelectorAll('div, p, li, ul, ol'))) {
    block.before('\n');
    block.after('\n');
  }
  return (copy.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}

function insertResumePlainText(editor: HTMLElement, transfer: DataTransfer) {
  const text = transfer.getData('text/plain');
  const selection = window.getSelection();
  if (!text || !selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return;
  range.deleteContents();
  const inserted = linkifyResumeText(text);
  const lastNode = inserted.lastChild;
  range.insertNode(inserted);
  if (lastNode) range.setStartAfter(lastNode);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  editor.dispatchEvent(
    new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }),
  );
}

async function allPages<T>(resource: string, signal: AbortSignal) {
  // ponytail: load authorized options in full for selects; switch to server search if startup latency grows.
  const rows: T[] = [];
  let page = 1;
  while (true) {
    const response = await api<Page<T>>(`${resource}?page=${page}`, undefined, signal);
    rows.push(...response.results);
    if (!response.next) return rows;
    page += 1;
  }
}

export function AiScreeningPage() {
  const [candidates, setCandidates] = useState<CandidateOption[]>([]);
  const [jobs, setJobs] = useState<JobOption[]>([]);
  const [enterprises, setEnterprises] = useState<EnterpriseOption[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState('');
  const [selectedApplication, setSelectedApplication] = useState<number | null>(null);
  const [selectedJob, setSelectedJob] = useState('');
  const [selectedEnterprise, setSelectedEnterprise] = useState('');
  const [resume, setResume] = useState('');
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState('');
  const [optionsRevision, setOptionsRevision] = useState(0);
  const [resumeNotice, setResumeNotice] = useState('');
  const [resumeError, setResumeError] = useState('');
  const [analysis, setAnalysis] = useState<ScreeningResult | null>(null);
  const [analysisError, setAnalysisError] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [loadingResume, setLoadingResume] = useState(false);
  const [copyNotice, setCopyNotice] = useState('');
  const [history, setHistory] = useState<HistoryPage | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState('');
  const [historyBusy, setHistoryBusy] = useState(false);
  const [savingQuestions, setSavingQuestions] = useState(false);
  const [questionNotice, setQuestionNotice] = useState('');
  const [questionError, setQuestionError] = useState('');
  const [confirmation, setConfirmation] = useState<
    { kind: 'questions' } | { kind: 'delete'; row: ScreeningHistory } | null
  >(null);
  const [dragging, setDragging] = useState(false);
  const resumeInput = useRef<HTMLInputElement>(null);
  const resumeEditor = useRef<HTMLDivElement>(null);
  const analysisRequest = useRef<AbortController | null>(null);
  const resultRegion = useRef<HTMLElement>(null);
  const analysisRetry = useRef<{ input: string; key: string } | null>(null);
  const confirmationDialog = useRef<HTMLDialogElement>(null);
  const confirmationBusy = useRef(false);

  useEffect(() => {
    const dialog = confirmationDialog.current;
    if (confirmation && dialog && !dialog.open) dialog.showModal();
    if (!confirmation && dialog?.open) dialog.close();
  }, [confirmation]);

  useEffect(() => () => analysisRequest.current?.abort(), []);
  useEffect(() => setCopyNotice(''), [analysis]);
  useEffect(() => {
    setQuestionNotice('');
    setQuestionError('');
  }, [analysis?.id]);

  useEffect(() => {
    const controller = new AbortController();
    setHistoryLoading(true);
    setHistoryError('');
    api<HistoryPage>(`ai-screenings/?page=${historyPage}`, undefined, controller.signal)
      .then(setHistory)
      .catch((error: Error) => {
        if (error.name !== 'AbortError') setHistoryError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setHistoryLoading(false);
      });
    return () => controller.abort();
  }, [historyPage, historyRevision]);

  const setResumeContent = useCallback((text: string, markup = '') => {
    setResume(text);
    if (!resumeEditor.current) return;
    if (markup) resumeEditor.current.innerHTML = sanitizeResumeMarkup(markup);
    else resumeEditor.current.replaceChildren(linkifyResumeText(text));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setOptionsLoading(true);
    setOptionsError('');
    Promise.all([
      allPages<ApplicationOption>('applications/', controller.signal),
      allPages<JobOption>('jobs/', controller.signal),
      api<EnterpriseOption[]>(
        'employer-brand/enterprises/ai-options/',
        undefined,
        controller.signal,
      ),
    ])
      .then(([applications, jobRows, enterpriseRows]) => {
        const uniqueCandidates = new Map<number, CandidateOption>();
        for (const application of applications) {
          if (!uniqueCandidates.has(application.candidate)) {
            uniqueCandidates.set(application.candidate, {
              id: application.candidate,
              name: application.name,
              applicationId: application.id,
            });
          }
        }
        setCandidates([...uniqueCandidates.values()]);
        setJobs(jobRows);
        setEnterprises(enterpriseRows);
      })
      .catch((error: Error) => {
        if (error.name !== 'AbortError') setOptionsError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setOptionsLoading(false);
      });
    return () => controller.abort();
  }, [optionsRevision]);

  useEffect(() => {
    if (selectedApplication === null) {
      setLoadingResume(false);
      return;
    }
    const controller = new AbortController();
    setLoadingResume(true);
    setAnalysis(null);
    setAnalysisError('');
    setResumeContent('');
    setResumeNotice('正在读取候选人的简历原文…');
    api<Application>(`applications/${selectedApplication}/`, undefined, controller.signal)
      .then((application) => {
        const source = application.resumes.find((item) => item.parse?.text.trim())?.parse?.text;
        if (source) {
          setResumeContent(source);
          setResumeNotice('已填入候选人的简历原文，可继续修改。');
        } else {
          setResumeNotice('暂时没有可用的简历原文，请直接粘贴简历内容。');
        }
      })
      .catch((error: Error) => {
        if (error.name !== 'AbortError')
          setResumeNotice('简历原文暂时无法读取，请直接粘贴简历内容。');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingResume(false);
      });
    return () => controller.abort();
  }, [selectedApplication, setResumeContent]);

  async function importResume(file?: File) {
    if (!file || analyzing || importing || loadingResume) return;
    setResumeNotice('');
    setResumeError('');
    if (!file.size || file.size > 10 * 1024 * 1024) {
      setResumeError('请选择非空且不超过 10MB 的附件。');
      return;
    }
    if (!/\.(pdf|docx|txt|md)$/i.test(file.name)) {
      setResumeError('目前支持 PDF、DOCX、TXT 和 MD；图片、扫描件及旧版 DOC 暂不支持识别。');
      return;
    }
    setAnalysis(null);
    setAnalysisError('');
    setImporting(true);
    try {
      if (/\.(txt|md)$/i.test(file.name)) {
        const text = await file.text();
        if (!text.trim()) throw new Error('附件中没有可读取的文字。');
        setResumeContent(text);
        setResumeNotice(`已导入 ${file.name}，可继续修改简历内容。`);
      } else {
        setResumeNotice(`正在识别 ${file.name}…`);
        const data = new FormData();
        data.set('file', file);
        const result = await api<{ text: string; html?: string }>('ai-screenings/extract/', data);
        setResumeContent(result.text, result.html);
        setResumeNotice(
          `已识别 ${file.name}，共 ${result.text.length.toLocaleString()} 字，请核对后开始分析。`,
        );
      }
    } catch (error) {
      setResumeNotice('');
      setResumeError((error as Error).message || '附件识别失败，请重试或直接粘贴简历原文。');
    } finally {
      setImporting(false);
    }
  }

  function clearForm() {
    analysisRetry.current = null;
    setSelectedCandidate('');
    setSelectedApplication(null);
    setSelectedJob('');
    setSelectedEnterprise('');
    setResumeContent('');
    setResumeNotice('');
    setResumeError('');
    setAnalysis(null);
    setAnalysisError('');
    if (resumeInput.current) resumeInput.current.value = '';
  }

  async function startAnalysis(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (analysisRequest.current || importing || loadingResume || historyBusy || savingQuestions)
      return;
    const text = resumeEditor.current ? resumeTextFromEditor(resumeEditor.current) : resume;
    if (!text.trim()) {
      setAnalysisError('请先填写或导入简历内容。');
      resumeEditor.current?.focus();
      return;
    }
    if (text.length > 30_000) {
      setAnalysisError('简历内容超过 30,000 字，请精简后再分析。');
      resumeEditor.current?.focus();
      return;
    }
    const controller = new AbortController();
    analysisRequest.current = controller;
    setAnalysisError('');
    setCopyNotice('');
    setAnalyzing(true);
    const input = {
      application_id: selectedApplication,
      job_id: selectedJob ? Number(selectedJob) : null,
      enterprise_id: selectedEnterprise ? Number(selectedEnterprise) : null,
      resume: text,
    };
    const serializedInput = JSON.stringify(input);
    if (analysisRetry.current?.input !== serializedInput) {
      analysisRetry.current = { input: serializedInput, key: crypto.randomUUID() };
    }
    try {
      setAnalysis(
        await api<ScreeningResult>(
          'ai-screenings/',
          { ...input, request_key: analysisRetry.current.key },
          controller.signal,
        ),
      );
      analysisRetry.current = null;
      setHistoryPage(1);
      setHistoryRevision((value) => value + 1);
      resultRegion.current?.scrollTo({ top: 0 });
    } catch (error) {
      if (!controller.signal.aborted) setAnalysisError((error as Error).message);
    } finally {
      if (analysisRequest.current === controller) analysisRequest.current = null;
      if (!controller.signal.aborted) setAnalyzing(false);
    }
  }

  async function viewHistory(row: ScreeningHistory) {
    if (historyBusy || analyzing || savingQuestions) return;
    setHistoryBusy(true);
    setHistoryError('');
    try {
      const result = await api<ScreeningResult>(`ai-screenings/${row.id}/`);
      setAnalysis(result);
      setAnalysisError('');
      resultRegion.current?.scrollTo({ top: 0 });
      resultRegion.current?.focus();
    } catch (error) {
      setHistoryError((error as Error).message);
    } finally {
      setHistoryBusy(false);
    }
  }

  async function deleteHistory(row: ScreeningHistory) {
    if (historyBusy || analyzing || savingQuestions) return;
    setHistoryBusy(true);
    setHistoryError('');
    try {
      await api(`ai-screenings/${row.id}/`, {}, undefined, 'DELETE');
      if (analysis?.id === row.id) setAnalysis(null);
      if (history?.items.length === 1 && historyPage > 1) setHistoryPage((value) => value - 1);
      else setHistoryRevision((value) => value + 1);
      setConfirmation(null);
    } catch (error) {
      setHistoryError((error as Error).message);
    } finally {
      setHistoryBusy(false);
    }
  }

  async function saveQuestions() {
    if (!analysis?.id || !analysis.questions.length || savingQuestions || analyzing || historyBusy)
      return;
    const reportId = analysis.id;
    setSavingQuestions(true);
    setQuestionError('');
    setQuestionNotice('');
    try {
      const result = await api<{ saved_question_count: number }>(
        `ai-screenings/${reportId}/questions/`,
        { confirmed: true },
      );
      setAnalysis((current) =>
        current?.id === reportId
          ? { ...current, saved_question_count: result.saved_question_count }
          : current,
      );
      setQuestionNotice(
        `已存入 ${result.saved_question_count} 道题，可到面试题库查看。重复点击不会重复入库。`,
      );
      setConfirmation(null);
    } catch (error) {
      setQuestionError((error as Error).message);
    } finally {
      setSavingQuestions(false);
    }
  }

  async function confirmAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirmation || confirmationBusy.current) return;
    confirmationBusy.current = true;
    try {
      if (confirmation.kind === 'questions') await saveQuestions();
      else await deleteHistory(confirmation.row);
    } finally {
      confirmationBusy.current = false;
    }
  }

  async function copyQuestions() {
    if (!analysis?.questions.length) return;
    const text = analysis.questions
      .map((item, index) =>
        [
          `${index + 1}. 题目：${item.question}`,
          `考察点：${item.reason || '未提供'}`,
          item.quote ? `简历依据：${item.quote}` : '',
          `追问：${item.follow_up || '模型未提供，请补充'}`,
          '合格回答要点：',
          ...(item.answer_points?.length
            ? item.answer_points.map((point) => `- ${point}`)
            : ['- 模型未提供，请补充']),
        ]
          .filter(Boolean)
          .join('\n'),
      )
      .join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopyNotice('已复制面试提纲，包含题目、追问和合格回答要点。');
    } catch {
      setCopyNotice('复制未成功，请选中下方提纲手动复制。');
    }
  }

  return (
    <div className="ai-screening-page">
      {optionsError && (
        <ErrorNotice
          message={optionsError}
          retry={() => setOptionsRevision((value) => value + 1)}
        />
      )}
      <div className="ai-screening-grid">
        <section className="dashboard-card ai-screening-card" aria-labelledby="ai-analysis-title">
          <header className="dashboard-card-head">
            <h2 id="ai-analysis-title">发起分析</h2>
          </header>
          <form className="ai-screening-form" onSubmit={startAnalysis}>
            <FieldGroup className="ai-screening-fields">
              <p className="ai-screening-help">候选人、职位和企业均可留空，仅导入简历也能分析。</p>
              <Field>
                <FieldLabel id="ai-candidate-label" htmlFor="ai-candidate">
                  选择候选人
                </FieldLabel>
                <Select
                  className="ai-screening-select"
                  id="ai-candidate"
                  aria-labelledby="ai-candidate-label"
                  value={selectedCandidate}
                  placeholder="请选择候选人（可留空）"
                  disabled={optionsLoading || Boolean(optionsError) || analyzing || importing}
                  clickToHide
                  dropdownClassName="candidate-select-dropdown"
                  onChange={(value) => {
                    const candidateId = typeof value === 'string' ? value : '';
                    const option = candidates.find((item) => String(item.id) === candidateId);
                    setSelectedCandidate(candidateId);
                    setSelectedApplication(option?.applicationId ?? null);
                    setAnalysis(null);
                    setAnalysisError('');
                    setResumeError('');
                  }}
                >
                  {candidates.map((candidate) => (
                    <Select.Option key={candidate.id} value={String(candidate.id)}>
                      {candidate.name}
                    </Select.Option>
                  ))}
                </Select>
              </Field>
              <Field>
                <FieldLabel id="ai-job-label" htmlFor="ai-job">
                  目标职位
                </FieldLabel>
                <Select
                  className="ai-screening-select"
                  id="ai-job"
                  aria-labelledby="ai-job-label"
                  value={selectedJob}
                  placeholder="请选择职位（可留空）"
                  disabled={optionsLoading || Boolean(optionsError) || analyzing || importing}
                  clickToHide
                  dropdownClassName="candidate-select-dropdown"
                  onChange={(value) => {
                    setSelectedJob(typeof value === 'string' ? value : '');
                    setAnalysis(null);
                    setAnalysisError('');
                  }}
                >
                  {jobs.map((job) => (
                    <Select.Option key={job.id} value={String(job.id)}>
                      {job.title}
                    </Select.Option>
                  ))}
                </Select>
              </Field>
              <Field>
                <FieldLabel id="ai-company-label" htmlFor="ai-company">
                  目标企业
                </FieldLabel>
                <Select
                  className="ai-screening-select"
                  id="ai-company"
                  aria-labelledby="ai-company-label"
                  value={selectedEnterprise || 'general'}
                  disabled={optionsLoading || Boolean(optionsError) || analyzing || importing}
                  clickToHide
                  dropdownClassName="candidate-select-dropdown"
                  onChange={(value) => {
                    setSelectedEnterprise(
                      typeof value === 'string' && value !== 'general' ? value : '',
                    );
                    setAnalysis(null);
                    setAnalysisError('');
                  }}
                >
                  <Select.Option value="general">不指定企业（通用初判）</Select.Option>
                  {enterprises.map((enterprise) => (
                    <Select.Option key={enterprise.id} value={String(enterprise.id)}>
                      {enterprise.name}
                    </Select.Option>
                  ))}
                </Select>
              </Field>
              <Field>
                <div className="ai-resume-heading">
                  <FieldLabel
                    id="ai-resume-label"
                    htmlFor="ai-resume"
                    onClick={() => resumeEditor.current?.focus()}
                  >
                    简历内容
                  </FieldLabel>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={analyzing || importing || loadingResume}
                    onClick={() => resumeInput.current?.click()}
                  >
                    <Upload data-icon="inline-start" />
                    导入简历附件
                  </Button>
                  <input
                    ref={resumeInput}
                    className="ai-resume-file"
                    type="file"
                    tabIndex={-1}
                    accept=".pdf,.docx,.txt,.md"
                    aria-label="导入简历附件"
                    onChange={(event) => {
                      void importResume(event.currentTarget.files?.[0]);
                      event.currentTarget.value = '';
                    }}
                  />
                </div>
                <fieldset
                  className={`ai-resume-drop${dragging ? ' is-dragging' : ''}`}
                  onDragEnter={(event) => {
                    event.preventDefault();
                    setDragging(true);
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                      setDragging(false);
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragging(false);
                    if (analyzing || importing || loadingResume) return;
                    void importResume(event.dataTransfer.files[0]);
                  }}
                >
                  <legend className="sr-only">简历附件拖放区</legend>
                  {/* biome-ignore lint/a11y/useSemanticElements: contentEditable preserves imported bold text and links. */}
                  {/* biome-ignore lint/a11y/useKeyWithClickEvents: Anchor links remain keyboard-activatable. */}
                  <div
                    ref={resumeEditor}
                    id="ai-resume"
                    className="ai-screening-textarea"
                    tabIndex={0}
                    role="textbox"
                    aria-labelledby="ai-resume-label"
                    aria-multiline="true"
                    aria-disabled={analyzing || importing || loadingResume}
                    aria-describedby="ai-resume-help"
                    aria-placeholder="选择候选人后会自动带出其简历原文，也可直接粘贴新内容"
                    data-placeholder="选择候选人后会自动带出其简历原文，也可直接粘贴新内容"
                    contentEditable={!analyzing && !importing && !loadingResume}
                    suppressContentEditableWarning
                    spellCheck
                    onInput={(event) => {
                      setResume(resumeTextFromEditor(event.currentTarget));
                      setResumeNotice('');
                      setResumeError('');
                      setAnalysis(null);
                      setAnalysisError('');
                    }}
                    onBlur={(event) => {
                      const editor = event.currentTarget;
                      editor.innerHTML = sanitizeResumeMarkup(editor.innerHTML);
                      setResume(resumeTextFromEditor(editor));
                    }}
                    onClick={(event) => {
                      const link = (event.target as HTMLElement).closest<HTMLAnchorElement>(
                        'a[href]',
                      );
                      if (!link || !event.currentTarget.contains(link)) return;
                      const href = safeResumeUrl(link.href);
                      if (!href || !/^https?:/i.test(href)) return;
                      event.preventDefault();
                      window.open(href, '_blank', 'noopener,noreferrer');
                    }}
                    onPaste={(event) => {
                      event.preventDefault();
                      if (analyzing || importing || loadingResume) return;
                      insertResumePlainText(event.currentTarget, event.clipboardData);
                    }}
                    onDrop={(event) => {
                      if (event.dataTransfer.files.length) return;
                      event.preventDefault();
                      if (analyzing || importing || loadingResume) return;
                      insertResumePlainText(event.currentTarget, event.dataTransfer);
                    }}
                  />
                </fieldset>
                <p className="ai-screening-help" id="ai-resume-help">
                  选择候选人后自动填充其「简历原文」，可覆盖修改；也可导入 PDF、DOCX、TXT 或
                  MD（≤10MB），或直接粘贴原文。扫描件和图片暂不支持 OCR。
                </p>
                {resumeNotice && (
                  <p className="ai-screening-notice" role="status">
                    {importing ? '正在识别附件文字…' : resumeNotice}
                  </p>
                )}
                {resumeError && <ErrorNotice message={resumeError} />}
              </Field>
            </FieldGroup>
            <div className="ai-screening-actions">
              <Button type="submit" size="lg" disabled={analyzing || importing || loadingResume}>
                <Sparkles data-icon="inline-start" />
                {analyzing ? '正在分析…' : analysis ? '重新分析' : '开始分析'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="lg"
                onClick={clearForm}
                disabled={analyzing || importing}
              >
                <Trash2 data-icon="inline-start" />
                清空
              </Button>
            </div>
          </form>
        </section>

        <section className="dashboard-card ai-screening-card" aria-labelledby="ai-result-title">
          <header className="dashboard-card-head">
            <h2 id="ai-result-title">分析结果</h2>
          </header>
          <section
            ref={resultRegion}
            className="ai-result-content"
            aria-label="分析结果内容"
            aria-busy={analyzing}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: 滚动区域需要键盘焦点来支持方向键和 PageDown。
            tabIndex={0}
          >
            {analyzing && (
              <p className="ai-screening-help p-6 text-center" role="status">
                正在整理简历依据并生成面试提纲，请稍候…
              </p>
            )}
            {analysisError && (
              <div className="p-5">
                <Alert variant="destructive">
                  <AlertTitle>本次分析未完成</AlertTitle>
                  <AlertDescription>
                    <p>{analysisError}</p>
                    {analysis && <p>上次分析结果仍保留在下方。</p>}
                    <Button
                      type="button"
                      variant="outline"
                      disabled={analyzing || importing || loadingResume}
                      onClick={() => void startAnalysis()}
                    >
                      <RotateCcw data-icon="inline-start" />
                      重试分析
                    </Button>
                  </AlertDescription>
                </Alert>
              </div>
            )}
            {analysis ? (
              <div className="ai-report">
                <div className="ai-report-overview">
                  <div className="ai-report-score">
                    <Progress
                      type="circle"
                      width={64}
                      strokeWidth={7}
                      percent={analysis.match_score ?? 0}
                      stroke="var(--warning)"
                      orbitStroke="var(--border)"
                      motion={false}
                      showInfo
                      format={() => analysis.match_score ?? '—'}
                      aria-label="匹配度分值"
                      aria-valuetext={
                        analysis.match_score == null
                          ? '未评分'
                          : `${analysis.match_score} 分，满分 100`
                      }
                    />
                    <div>
                      <p className="text-muted-foreground">匹配度分值</p>
                      <p>{analysis.match_score == null ? '未评分' : '满分 100'}</p>
                    </div>
                  </div>
                  <div className="ai-report-meta">
                    <Badge variant="secondary">{analysis.conclusion || '待复核'}</Badge>
                    <p>目标职位：{analysis.job_title || '—'}</p>
                    <p>分析时间：{analysisTime(analysis.created_at)}</p>
                  </div>
                </div>
                <section>
                  <h3>匹配理由</h3>
                  <p>{analysis.summary}</p>
                  <details className="ai-report-evidence">
                    <summary>简历依据 · {analysis.evidence.length} 项</summary>
                    {analysis.evidence.length ? (
                      analysis.evidence.map((item) => (
                        <div key={`${item.criterion}-${item.quote}`}>
                          <h4>{item.criterion}</h4>
                          <blockquote>{item.quote}</blockquote>
                          <p>{item.reason}</p>
                        </div>
                      ))
                    ) : (
                      <p>模型未返回可核验的简历原文依据。</p>
                    )}
                  </details>
                </section>
                <section>
                  <h3>风险点</h3>
                  {analysis.gaps.length ? (
                    <ol className="ai-report-risks">
                      {analysis.gaps.map((item) => (
                        <li key={`${item.criterion}-${item.note}`}>
                          {item.criterion}：{item.note}
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="text-muted-foreground">
                      模型未列出待核实信息，不代表不存在风险。
                    </p>
                  )}
                </section>
                <section aria-labelledby="ai-questions-title">
                  <h3 id="ai-questions-title">建议面试问题</h3>
                  {analysis.questions.length ? (
                    <ol className="ai-report-questions">
                      {analysis.questions.map((item, index) => (
                        <li key={`${item.question}-${item.reason}`}>
                          <article aria-label={`第 ${index + 1} 题`}>
                            {item.question}（考察点：{item.reason || '模型未提供'}）{' → 追问：'}
                            {item.follow_up || '模型未提供，请补充。'}
                            {' → 合格：'}
                            {item.answer_points?.length
                              ? item.answer_points.join('；')
                              : '模型未提供，请补充。'}
                          </article>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="text-muted-foreground">模型未返回面试追问。</p>
                  )}
                  <div className="ai-report-actions">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={
                        !analysis.id ||
                        !analysis.questions.length ||
                        analyzing ||
                        historyBusy ||
                        savingQuestions ||
                        (analysis.saved_question_count ?? 0) > 0
                      }
                      onClick={() => {
                        setQuestionError('');
                        setConfirmation({ kind: 'questions' });
                      }}
                    >
                      {savingQuestions
                        ? '正在存入…'
                        : (analysis.saved_question_count ?? 0) > 0
                          ? `已存入题库（${analysis.saved_question_count} 题）`
                          : '一键存入面试题库'}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={!analysis.questions.length || analyzing}
                      onClick={() => void copyQuestions()}
                    >
                      <Copy data-icon="inline-start" />
                      复制提纲
                    </Button>
                  </div>
                  {questionError && <ErrorNotice message={questionError} />}
                  {questionNotice && (
                    <p className="ai-screening-notice" role="status">
                      {questionNotice} <a href="#question-bank">查看面试题库</a>
                    </p>
                  )}
                  {copyNotice && (
                    <p className="ai-screening-help" role="status">
                      {copyNotice}
                    </p>
                  )}
                </section>
                <section>
                  <h3>建议追问方向</h3>
                  <p>
                    {analysis.follow_up_direction || '模型未提供整体追问方向，请结合上方问题核实。'}
                  </p>
                </section>
                <p className="ai-screening-help">{analysis.limitations}</p>
              </div>
            ) : !analyzing && !analysisError ? (
              <Empty className="ai-result-empty">
                <EmptyHeader>
                  <EmptyMedia className="ai-empty-icon">
                    <Crosshair aria-hidden="true" />
                  </EmptyMedia>
                  <EmptyTitle>尚未发起分析</EmptyTitle>
                  <EmptyDescription>左侧填写后点击「开始分析」</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : null}
          </section>
        </section>
      </div>

      <section
        className="dashboard-card ai-screening-card ai-history-card"
        aria-labelledby="ai-history-title"
      >
        <header className="dashboard-card-head">
          <h2 id="ai-history-title">历史分析记录</h2>
          <Button
            variant="outline"
            size="sm"
            disabled={historyLoading || historyBusy}
            onClick={() => setHistoryRevision((value) => value + 1)}
          >
            <RotateCcw data-icon="inline-start" />
            刷新
          </Button>
        </header>
        {historyError && (
          <div className="p-4">
            <ErrorNotice
              message={historyError}
              retry={() => setHistoryRevision((value) => value + 1)}
            />
          </div>
        )}
        {historyLoading ? (
          <Loading />
        ) : history?.items.length ? (
          <>
            <div className="ai-history-scroll">
              <table className="ai-history-table">
                <caption className="sr-only">历史分析记录列表</caption>
                <thead>
                  <tr>
                    {[
                      '候选人',
                      '目标职位',
                      '企业',
                      '结论',
                      '匹配度',
                      '分析时间',
                      '问题数',
                      '操作',
                    ].map((label) => (
                      <th key={label} scope="col">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {history.items.map((row) => (
                    <tr key={row.id} aria-selected={analysis?.id === row.id}>
                      <td>
                        {row.candidate_name || '—'}
                        <small>{row.code}</small>
                      </td>
                      <td>{row.job_title || '—'}</td>
                      <td>{row.enterprise_name || '—'}</td>
                      <td>
                        <Badge variant="secondary">{row.conclusion}</Badge>
                      </td>
                      <td>{row.match_score ?? '—'}</td>
                      <td className="whitespace-nowrap">{analysisTime(row.created_at)}</td>
                      <td>{row.question_count}</td>
                      <td>
                        <div className="flex gap-1">
                          <Button
                            variant="link"
                            size="sm"
                            disabled={historyBusy || analyzing || savingQuestions}
                            onClick={() => void viewHistory(row)}
                          >
                            查看
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            disabled={historyBusy || analyzing || savingQuestions}
                            onClick={() => {
                              setHistoryError('');
                              setConfirmation({ kind: 'delete', row });
                            }}
                          >
                            删除
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={historyPage} count={history.count} onChange={setHistoryPage} />
          </>
        ) : !historyError ? (
          <Empty className="ai-history-empty">
            <EmptyHeader>
              <EmptyMedia className="ai-empty-icon">
                <Bot aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>还没有 AI 初面记录</EmptyTitle>
              <EmptyDescription>左侧发起一次分析，成功后的结果会保存在这里。</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}
      </section>
      <dialog
        ref={confirmationDialog}
        className="enterprise-dialog enterprise-profile-dialog"
        aria-labelledby="ai-confirm-title"
        aria-describedby="ai-confirm-description"
        onCancel={(event) => {
          event.preventDefault();
          if (!confirmationBusy.current) setConfirmation(null);
        }}
      >
        {confirmation && (
          <form onSubmit={(event) => void confirmAction(event)}>
            <div className="enterprise-dialog-heading">
              <h2 id="ai-confirm-title">
                {confirmation.kind === 'questions' ? '存入面试题库' : '删除分析记录'}
              </h2>
            </div>
            <div className="enterprise-dialog-body">
              <p id="ai-confirm-description">
                {confirmation.kind === 'questions'
                  ? `确认将这 ${analysis?.questions.length ?? 0} 道题存入组织面试题库？题目、追问和合格回答要点将对本组织可查看题库的成员可见，请先确认没有不宜共享的个人信息。`
                  : `确定删除分析记录 ${confirmation.row.code} 吗？此操作不会删除已存入题库的题目。`}
              </p>
              {confirmation.kind === 'questions'
                ? questionError && <ErrorNotice message={questionError} />
                : historyError && <ErrorNotice message={historyError} />}
            </div>
            <div className="enterprise-dialog-footer">
              <Button
                type="button"
                variant="outline"
                disabled={savingQuestions || historyBusy}
                onClick={() => {
                  if (!confirmationBusy.current) setConfirmation(null);
                }}
              >
                取消
              </Button>
              <Button
                type="submit"
                variant={confirmation.kind === 'delete' ? 'destructive' : 'default'}
                disabled={savingQuestions || historyBusy}
              >
                {confirmation.kind === 'questions'
                  ? savingQuestions
                    ? '正在存入…'
                    : '确认存入'
                  : historyBusy
                    ? '正在删除…'
                    : '确认删除'}
              </Button>
            </div>
          </form>
        )}
      </dialog>
    </div>
  );
}
