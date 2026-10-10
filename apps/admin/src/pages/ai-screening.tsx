import Select from '@douyinfe/semi-ui/lib/es/select';
import { Bot, Copy, Crosshair, RotateCcw, Sparkles, Trash2, Upload } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { ErrorNotice, Loading, Pager } from '@/components/feedback';
import { type RequirementMatch, RequirementMatches } from '@/components/requirement-matches';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ApiError, api, type Job, type Page } from '@/lib/api';
import type { Application } from '@/lib/intake';
import { AiQuestionSelection } from './ai-question-selection';
import {
  ScreeningQualityNotice,
  type ScreeningSource,
  ScreeningSourceDetails,
  ScreeningVerification,
  type Verification,
} from './ai-screening-verification';

type ApplicationOption = Pick<
  Application,
  'id' | 'candidate' | 'name' | 'job' | 'job_title' | 'attempt_no'
>;
type JobOption = Pick<
  Job,
  'id' | 'title' | 'enterprise_id' | 'enterprise_name' | 'enterprise_enabled' | 'enterprise_deleted'
>;
type EnterpriseOption = { id: number; name: string; industry: string };
type EnterpriseSnapshot = {
  id: number;
  name: string;
  industry: string;
  introduction: string;
  updated_at: string;
  endorsements: {
    id: number;
    category: string;
    category_label: string;
    title: string;
    body: string;
    updated_at: string;
  }[];
};
type CandidateOption = ApplicationOption;
type ScreeningResult = {
  id?: number;
  code?: string;
  created_at?: string;
  candidate_name?: string;
  job_title?: string;
  enterprise_name?: string;
  enterprise_snapshot?: EnterpriseSnapshot | null;
  saved_question_count?: number;
  questions_saved?: boolean;
  quality_version?: number;
  analysis_date?: string | null;
  analysis_issues?: string[];
  conclusion?: string;
  follow_up_direction?: string;
  summary: string;
  evidence: { criterion: string; quote: string; reason: string }[];
  gaps: {
    criterion: string;
    note: string;
    kind?: 'material_missing' | 'material_conflict' | 'analysis_error';
    requirement_id?: number | null;
    quotes?: string[];
  }[];
  questions: {
    requirement_id?: number | null;
    origin?: 'generated' | 'verification_fallback';
    question: string;
    reason: string;
    follow_up: string;
    answer_points: string[];
    quote: string;
  }[];
  limitations: string;
  source_context?: ScreeningSource | null;
  requirement_matches?: RequirementMatch[];
  verifications?: Verification[];
};
type ScreeningHistory = {
  id: number;
  code: string;
  candidate_name: string;
  job_title: string;
  enterprise_name: string;
  conclusion: string;
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

function EnterpriseContext({
  snapshot,
  recorded = false,
  reportCode,
}: {
  snapshot: EnterpriseSnapshot;
  recorded?: boolean;
  reportCode?: string;
}) {
  const query = new URLSearchParams({ enterprise: String(snapshot.id) });
  if (reportCode) query.set('source', `AI 初面报告 ${reportCode}`);
  return (
    <details className="ai-report-evidence">
      <summary>
        {recorded ? '本次使用的企业资料' : '预览企业资料'} · {snapshot.name}
      </summary>
      <div className="flex min-w-0 flex-col gap-3">
        <p className="text-muted-foreground">
          {recorded
            ? '以下为分析时实际使用的资料留档，企业后续修改不会改变本记录。'
            : '当前每类取排序最前的启用文字内容；实际使用内容以分析报告留档为准。'}
        </p>
        <p>
          {snapshot.industry || '行业未填写'} · 企业资料更新于 {analysisTime(snapshot.updated_at)}
        </p>
        <p className="whitespace-pre-wrap wrap-anywhere">
          {snapshot.introduction || '企业简介未填写。'}
        </p>
        {snapshot.endorsements.map((item) => (
          <section key={item.id} className="flex flex-col gap-1">
            <h4>
              {item.category_label} · {item.title || '未填写标题'}
            </h4>
            <p className="whitespace-pre-wrap wrap-anywhere">{item.body || '未填写正文。'}</p>
            <p className="text-muted-foreground">更新于 {analysisTime(item.updated_at)}</p>
          </section>
        ))}
        {!snapshot.endorsements.length && <p>暂无可用的背书内容。</p>}
        <a
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
          href={`#employer-brand?${query}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          查看企业资料或登记问题（新页）
        </a>
      </div>
    </details>
  );
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
  const [enterprisePreview, setEnterprisePreview] = useState<EnterpriseSnapshot | null>(null);
  const [enterprisePreviewLoading, setEnterprisePreviewLoading] = useState(false);
  const [enterprisePreviewError, setEnterprisePreviewError] = useState('');
  const [enterprisePreviewRevision, setEnterprisePreviewRevision] = useState(0);
  const [resume, setResume] = useState('');
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState('');
  const [optionsRevision, setOptionsRevision] = useState(0);
  const [resumeNotice, setResumeNotice] = useState('');
  const [resumeError, setResumeError] = useState('');
  const [analysis, setAnalysis] = useState<ScreeningResult | null>(null);
  const updateVerifications = useCallback((items: Verification[]) => {
    setAnalysis((current) => (current ? { ...current, verifications: items } : current));
  }, []);
  const [viewingHistory, setViewingHistory] = useState(false);
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
  const [confirmation, setConfirmation] = useState<{
    kind: 'delete';
    row: ScreeningHistory;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [verificationEditing, setVerificationEditing] = useState(false);
  const [resumeParseId, setResumeParseId] = useState<number | null>(null);
  const [sourceNote, setSourceNote] = useState('');
  const resumeInput = useRef<HTMLInputElement>(null);
  const resumeEditor = useRef<HTMLDivElement>(null);
  const analysisRequest = useRef<AbortController | null>(null);
  const historyRequest = useRef<AbortController | null>(null);
  const candidateResumeRequest = useRef<AbortController | null>(null);
  const resultRegion = useRef<HTMLElement>(null);
  const analysisRetry = useRef<{ input: string; key: string } | null>(null);
  const confirmationDialog = useRef<HTMLDialogElement>(null);
  const confirmationBusy = useRef(false);
  const questionsSaved = analysis?.questions_saved ?? (analysis?.saved_question_count ?? 0) > 0;
  const selectedJobRow = jobs.find((job) => String(job.id) === selectedJob);
  const linkedEnterpriseId = selectedJobRow?.enterprise_id;
  const effectiveEnterpriseId = linkedEnterpriseId
    ? String(linkedEnterpriseId)
    : selectedEnterprise;
  const enterpriseUnavailable = Boolean(
    linkedEnterpriseId &&
      (selectedJobRow.enterprise_enabled === false || selectedJobRow.enterprise_deleted),
  );

  useEffect(() => {
    setEnterprisePreview(null);
    setEnterprisePreviewError('');
    if (!effectiveEnterpriseId || enterpriseUnavailable) {
      setEnterprisePreviewLoading(false);
      return;
    }
    const controller = new AbortController();
    setEnterprisePreviewLoading(true);
    api<EnterpriseSnapshot>(
      `employer-brand/enterprises/${effectiveEnterpriseId}/ai-context/`,
      undefined,
      controller.signal,
    )
      .then((snapshot) => {
        if (!controller.signal.aborted) setEnterprisePreview(snapshot);
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted) setEnterprisePreviewError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setEnterprisePreviewLoading(false);
      });
    return () => controller.abort();
  }, [effectiveEnterpriseId, enterpriseUnavailable, enterprisePreviewRevision]);

  useEffect(() => {
    const dialog = confirmationDialog.current;
    if (confirmation && dialog && !dialog.open) dialog.showModal();
    if (!confirmation && dialog?.open) dialog.close();
  }, [confirmation]);

  useEffect(
    () => () => {
      analysisRequest.current?.abort();
      historyRequest.current?.abort();
      candidateResumeRequest.current?.abort();
    },
    [],
  );
  useEffect(() => setCopyNotice(''), [analysis]);
  useEffect(() => {
    setQuestionNotice('');
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

  const cancelHistoryView = useCallback(() => {
    if (!historyRequest.current) return;
    historyRequest.current.abort();
    historyRequest.current = null;
    setHistoryBusy(false);
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
        setCandidates(applications);
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
    candidateResumeRequest.current = controller;
    setLoadingResume(true);
    setAnalysis(null);
    setViewingHistory(false);
    setAnalysisError('');
    setResumeNotice('正在读取候选人的简历原文…');
    api<Application>(`applications/${selectedApplication}/`, undefined, controller.signal)
      .then((application) => {
        if (controller.signal.aborted) return;
        const source = application.resumes.find((item) => item.parse?.text.trim());
        if (source?.parse) {
          setResumeContent(source.parse.text);
          setResumeParseId(source.parse.id);
          setSourceNote(`本地应聘 #${application.id} 的简历：${source.name}`);
          setResumeNotice('已填入候选人的简历原文，可继续修改。');
        } else {
          setResumeContent('');
          setResumeParseId(null);
          setResumeNotice('暂时没有可用的简历原文，请直接粘贴简历内容。');
        }
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted && error.name !== 'AbortError') {
          setResumeContent('');
          setResumeNotice('简历原文暂时无法读取，请直接粘贴简历内容。');
        }
      })
      .finally(() => {
        if (candidateResumeRequest.current === controller) candidateResumeRequest.current = null;
        if (!controller.signal.aborted) setLoadingResume(false);
      });
    return () => controller.abort();
  }, [selectedApplication, setResumeContent]);

  async function importResume(file?: File) {
    if (!file || analyzing || importing || loadingResume || verificationEditing) return;
    cancelHistoryView();
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
      setResumeParseId(null);
      setSourceNote(`手动导入附件：${file.name}`);
      setAnalysis(null);
      setViewingHistory(false);
      setAnalysisError('');
    } catch (error) {
      setResumeNotice('');
      setResumeError((error as Error).message || '附件识别失败，请重试或直接粘贴简历原文。');
    } finally {
      setImporting(false);
    }
  }

  function clearForm() {
    if (verificationEditing) return;
    cancelHistoryView();
    candidateResumeRequest.current?.abort();
    candidateResumeRequest.current = null;
    setLoadingResume(false);
    analysisRetry.current = null;
    setSelectedCandidate('');
    setSelectedApplication(null);
    setSelectedJob('');
    setSelectedEnterprise('');
    setResumeContent('');
    setResumeParseId(null);
    setSourceNote('');
    setResumeNotice('');
    setResumeError('');
    setAnalysis(null);
    setViewingHistory(false);
    setAnalysisError('');
    if (resumeInput.current) resumeInput.current.value = '';
  }

  async function startAnalysis(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (
      analysisRequest.current ||
      importing ||
      loadingResume ||
      historyBusy ||
      savingQuestions ||
      verificationEditing
    )
      return;
    if (enterpriseUnavailable) {
      setAnalysisError('职位关联的企业已停用或删除，请先在企业背书中调整关联并刷新选项。');
      return;
    }
    if (
      effectiveEnterpriseId &&
      (optionsLoading ||
        optionsError ||
        enterprisePreviewLoading ||
        enterprisePreviewError ||
        enterprisePreview?.id !== Number(effectiveEnterpriseId))
    ) {
      setAnalysisError('请先加载并核对企业资料，再开始分析。');
      return;
    }
    const text =
      resumeParseId !== null
        ? resume
        : resumeEditor.current
          ? resumeTextFromEditor(resumeEditor.current)
          : resume;
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
      enterprise_id: effectiveEnterpriseId ? Number(effectiveEnterpriseId) : null,
      resume: text,
      resume_parse_id: resumeParseId,
      source_note: sourceNote,
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
      setViewingHistory(false);
      analysisRetry.current = null;
      setHistoryPage(1);
      setHistoryRevision((value) => value + 1);
      resultRegion.current?.scrollTo({ top: 0 });
    } catch (error) {
      if (!controller.signal.aborted) {
        if (error instanceof ApiError && error.status === 409) analysisRetry.current = null;
        setAnalysisError((error as Error).message);
      }
    } finally {
      if (analysisRequest.current === controller) analysisRequest.current = null;
      if (!controller.signal.aborted) setAnalyzing(false);
    }
  }

  async function viewHistory(row: ScreeningHistory) {
    if (
      historyBusy ||
      analyzing ||
      savingQuestions ||
      importing ||
      loadingResume ||
      verificationEditing
    )
      return;
    const controller = new AbortController();
    historyRequest.current = controller;
    setHistoryBusy(true);
    setHistoryError('');
    try {
      const result = await api<ScreeningResult>(
        `ai-screenings/${row.id}/`,
        undefined,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setAnalysis(result);
      setViewingHistory(true);
      setAnalysisError('');
      resultRegion.current?.scrollTo({ top: 0 });
      resultRegion.current?.focus();
    } catch (error) {
      if (!controller.signal.aborted) setHistoryError((error as Error).message);
    } finally {
      if (historyRequest.current === controller) {
        historyRequest.current = null;
        setHistoryBusy(false);
      }
    }
  }

  async function deleteHistory(row: ScreeningHistory) {
    if (historyBusy || analyzing || savingQuestions || verificationEditing) return;
    setHistoryBusy(true);
    setHistoryError('');
    try {
      await api(`ai-screenings/${row.id}/`, {}, undefined, 'DELETE');
      if (analysis?.id === row.id) {
        setAnalysis(null);
        setViewingHistory(false);
      }
      if (history?.items.length === 1 && historyPage > 1) setHistoryPage((value) => value - 1);
      else setHistoryRevision((value) => value + 1);
      setConfirmation(null);
    } catch (error) {
      setHistoryError((error as Error).message);
    } finally {
      setHistoryBusy(false);
    }
  }

  async function confirmAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirmation || confirmationBusy.current) return;
    confirmationBusy.current = true;
    try {
      await deleteHistory(confirmation.row);
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
          item.requirement_id
            ? `对应岗位要求：${analysis.requirement_matches?.find((match) => match.requirement_id === item.requirement_id)?.text || `#${item.requirement_id}`}`
            : '',
          item.origin === 'verification_fallback' ? '来源：系统补齐的核实题' : '',
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
      await navigator.clipboard.writeText(
        `面试核实提纲：回答要点仅供人工核实，不自动判定合格。\n\n${text}`,
      );
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
                  motion={false}
                  value={selectedCandidate}
                  placeholder="请选择候选人（可留空）"
                  disabled={
                    optionsLoading ||
                    Boolean(optionsError) ||
                    analyzing ||
                    importing ||
                    verificationEditing
                  }
                  clickToHide
                  dropdownClassName="candidate-select-dropdown"
                  onChange={(value) => {
                    const candidateId = typeof value === 'string' ? value : '';
                    if (candidateId === selectedCandidate || verificationEditing) return;
                    cancelHistoryView();
                    candidateResumeRequest.current?.abort();
                    candidateResumeRequest.current = null;
                    setLoadingResume(false);
                    const option = candidates.find((item) => String(item.id) === candidateId);
                    setSelectedCandidate(candidateId);
                    setSelectedApplication(option?.id ?? null);
                    if (option) setSelectedJob(String(option.job));
                    setSelectedEnterprise('');
                    setResumeParseId(null);
                    setSourceNote('');
                    setAnalysis(null);
                    setViewingHistory(false);
                    setAnalysisError('');
                    setResumeNotice('');
                    setResumeError('');
                  }}
                >
                  <Select.Option value="">请选择候选人（可留空）</Select.Option>
                  {candidates.map((candidate) => (
                    <Select.Option
                      key={candidate.id}
                      value={String(candidate.id)}
                      label={`${candidate.name} · ${candidate.job_title} · 第 ${candidate.attempt_no} 次应聘`}
                    >
                      {candidate.name} · {candidate.job_title} · 第 {candidate.attempt_no} 次应聘
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
                  motion={false}
                  value={selectedJob}
                  placeholder="请选择职位（可留空）"
                  disabled={
                    optionsLoading ||
                    Boolean(optionsError) ||
                    analyzing ||
                    importing ||
                    verificationEditing
                  }
                  clickToHide
                  dropdownClassName="candidate-select-dropdown"
                  onChange={(value) => {
                    if (verificationEditing) return;
                    cancelHistoryView();
                    const jobId = typeof value === 'string' ? value : '';
                    const selected = candidates.find((item) => item.id === selectedApplication);
                    if (selected && jobId && String(selected.job) !== jobId) {
                      setResumeError('目标职位与当前应聘不一致，请先选择该职位对应的应聘。');
                      return;
                    }
                    setSelectedJob(jobId);
                    setSelectedEnterprise('');
                    setAnalysis(null);
                    setViewingHistory(false);
                    setAnalysisError('');
                  }}
                >
                  <Select.Option value="">请选择职位（可留空）</Select.Option>
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
                  motion={false}
                  value={effectiveEnterpriseId || 'general'}
                  disabled={
                    optionsLoading ||
                    Boolean(optionsError) ||
                    analyzing ||
                    importing ||
                    Boolean(linkedEnterpriseId) ||
                    verificationEditing
                  }
                  clickToHide
                  dropdownClassName="candidate-select-dropdown"
                  onChange={(value) => {
                    if (verificationEditing) return;
                    cancelHistoryView();
                    setSelectedEnterprise(
                      typeof value === 'string' && value !== 'general' ? value : '',
                    );
                    setAnalysis(null);
                    setViewingHistory(false);
                    setAnalysisError('');
                  }}
                >
                  <Select.Option value="general">不指定企业（通用初判）</Select.Option>
                  {linkedEnterpriseId &&
                    !enterprises.some((item) => item.id === linkedEnterpriseId) && (
                      <Select.Option value={String(linkedEnterpriseId)}>
                        {selectedJobRow?.enterprise_name || '关联企业'}（不可用）
                      </Select.Option>
                    )}
                  {enterprises.map((enterprise) => (
                    <Select.Option key={enterprise.id} value={String(enterprise.id)}>
                      {enterprise.name}
                    </Select.Option>
                  ))}
                </Select>
                {linkedEnterpriseId && (
                  <p className="ai-screening-help">
                    {enterpriseUnavailable
                      ? '职位关联的企业已停用或删除，请先调整企业状态或职位关联。'
                      : '已自动使用职位所属企业；企业归属可在企业背书中调整。'}
                    <a
                      className={buttonVariants({ variant: 'link', size: 'sm' })}
                      href={`#employer-brand?enterprise=${linkedEnterpriseId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      查看企业（新页）
                    </a>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={analyzing || importing || optionsLoading}
                      onClick={() => {
                        setOptionsRevision((value) => value + 1);
                        setEnterprisePreviewRevision((value) => value + 1);
                      }}
                    >
                      刷新关联
                    </Button>
                  </p>
                )}
                {enterprisePreviewLoading && <p role="status">正在加载企业资料…</p>}
                {enterprisePreviewError && (
                  <Alert variant="destructive">
                    <AlertTitle>企业资料未加载</AlertTitle>
                    <AlertDescription>
                      <p>{enterprisePreviewError}</p>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setEnterprisePreviewRevision((value) => value + 1)}
                      >
                        重新加载企业资料
                      </Button>
                    </AlertDescription>
                  </Alert>
                )}
                {enterprisePreview && String(enterprisePreview.id) === effectiveEnterpriseId && (
                  <EnterpriseContext snapshot={enterprisePreview} />
                )}
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
                    disabled={analyzing || importing || loadingResume || verificationEditing}
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
                    if (analyzing || importing || loadingResume || verificationEditing) return;
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
                    aria-disabled={analyzing || importing || loadingResume || verificationEditing}
                    aria-describedby="ai-resume-help"
                    aria-placeholder="选择候选人后会自动带出其简历原文，也可直接粘贴新内容"
                    data-placeholder="选择候选人后会自动带出其简历原文，也可直接粘贴新内容"
                    contentEditable={
                      !analyzing && !importing && !loadingResume && !verificationEditing
                    }
                    suppressContentEditableWarning
                    spellCheck
                    onInput={(event) => {
                      if (verificationEditing) return;
                      cancelHistoryView();
                      setResume(resumeTextFromEditor(event.currentTarget));
                      if (resumeParseId !== null)
                        setSourceNote('基于所关联的应聘简历人工编辑，保留原材料来源');
                      setResumeNotice('');
                      setResumeError('');
                      setAnalysis(null);
                      setViewingHistory(false);
                      setAnalysisError('');
                    }}
                    onBlur={(event) => {
                      const editor = event.currentTarget;
                      editor.innerHTML = sanitizeResumeMarkup(editor.innerHTML);
                      if (resumeParseId === null) setResume(resumeTextFromEditor(editor));
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
                      if (analyzing || importing || loadingResume || verificationEditing) return;
                      insertResumePlainText(event.currentTarget, event.clipboardData);
                    }}
                    onDrop={(event) => {
                      if (event.dataTransfer.files.length) return;
                      event.preventDefault();
                      if (analyzing || importing || loadingResume || verificationEditing) return;
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
              <details>
                <summary className="ai-screening-help cursor-pointer">材料来源说明（可选）</summary>
                <Field className="mt-2">
                  <FieldLabel htmlFor="ai-source-note">来源备注</FieldLabel>
                  <Input
                    id="ai-source-note"
                    value={sourceNote}
                    maxLength={500}
                    disabled={analyzing || importing || loadingResume || verificationEditing}
                    placeholder="例如：从飞书手动提供，仅作核实参考"
                    onChange={(event) => setSourceNote(event.target.value)}
                  />
                </Field>
              </details>
            </FieldGroup>
            <div className="ai-screening-actions">
              <Button
                type="submit"
                size="lg"
                disabled={
                  analyzing ||
                  importing ||
                  loadingResume ||
                  historyBusy ||
                  savingQuestions ||
                  verificationEditing
                }
              >
                <Sparkles data-icon="inline-start" />
                {analyzing
                  ? '正在分析…'
                  : viewingHistory
                    ? '分析当前简历'
                    : analysis
                      ? '重新分析'
                      : '开始分析'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="lg"
                onClick={clearForm}
                disabled={analyzing || importing || verificationEditing}
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
                      disabled={
                        analyzing ||
                        importing ||
                        loadingResume ||
                        historyBusy ||
                        savingQuestions ||
                        verificationEditing
                      }
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
                {analysis.enterprise_snapshot ? (
                  <EnterpriseContext
                    snapshot={analysis.enterprise_snapshot}
                    recorded
                    reportCode={analysis.code || String(analysis.id ?? '')}
                  />
                ) : analysis.enterprise_name ? (
                  <p className="text-muted-foreground">
                    该历史报告未留存企业资料快照，无法还原当时使用的内容。
                  </p>
                ) : null}
                {viewingHistory && (
                  <Alert role="status">
                    <AlertTitle>历史分析记录 {analysis.code || analysis.id}</AlertTitle>
                    <AlertDescription>
                      <p>候选人：{analysis.candidate_name || '未关联候选人'}</p>
                      <p>目标企业：{analysis.enterprise_name || '未指定企业'}</p>
                      <p>仅查看历史；左侧输入未替换</p>
                    </AlertDescription>
                  </Alert>
                )}
                <ScreeningQualityNotice report={analysis} />
                <div className="ai-report-overview">
                  <div className="ai-report-meta">
                    <Badge variant="secondary">AI 材料整理 · 待人工核实</Badge>
                    <p>目标职位：{analysis.job_title || '—'}</p>
                    <p>分析时间：{analysisTime(analysis.created_at)}</p>
                  </div>
                </div>
                <section>
                  <ScreeningSourceDetails source={analysis.source_context} />
                  <h3>材料整理</h3>
                  <p>{analysis.summary}</p>
                  {analysis.requirement_matches && analysis.requirement_matches.length > 0 && (
                    <RequirementMatches
                      items={analysis.requirement_matches}
                      questions={analysis.questions}
                    />
                  )}
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
                  <h3>待核实事项</h3>
                  {analysis.gaps.length ? (
                    <div className="flex flex-col gap-4">
                      {(
                        [
                          ['material_missing', '材料待补充'],
                          ['material_conflict', '材料存在矛盾'],
                          ['analysis_error', '分析需重试'],
                        ] as const
                      ).map(([kind, title]) => {
                        const gaps = analysis.gaps.filter(
                          (item) => (item.kind || 'material_missing') === kind,
                        );
                        if (!gaps.length) return null;
                        return (
                          <section key={kind} aria-label={title} className="flex flex-col gap-2">
                            <h4>{title}</h4>
                            {kind === 'analysis_error' && (
                              <p className="text-sm text-muted-foreground">
                                请重新分析或对照原文人工核实，不作为人选负面判断。
                              </p>
                            )}
                            <ol className="flex list-decimal flex-col gap-3 pl-5">
                              {gaps.map((item) => (
                                <li key={`${item.requirement_id}-${item.criterion}`}>
                                  <p>
                                    {item.criterion}：{item.note}
                                  </p>
                                  {item.quotes?.map((quote) => (
                                    <blockquote
                                      key={quote}
                                      className="border-l-2 pl-3 text-sm whitespace-pre-wrap"
                                    >
                                      简历原文：{quote}
                                    </blockquote>
                                  ))}
                                </li>
                              ))}
                            </ol>
                          </section>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-muted-foreground">
                      模型未列出待核实信息，不代表不存在风险。
                    </p>
                  )}
                </section>
                <section aria-labelledby="ai-questions-title">
                  <h3 id="ai-questions-title">建议面试问题</h3>
                  <p className="text-sm text-muted-foreground">
                    合格回答要点仅供人工核实，不自动判定合格。优先核实重要的材料缺口与矛盾。
                  </p>
                  {analysis.questions.length ? (
                    <ol className="ai-report-questions">
                      {analysis.questions.map((item, index) => (
                        <li key={`${item.question}-${item.reason}`}>
                          <article aria-label={`第 ${index + 1} 题`}>
                            {(item.requirement_id || item.origin === 'verification_fallback') && (
                              <div className="mb-2 flex flex-wrap gap-2">
                                {item.requirement_id && (
                                  <Badge variant="outline">
                                    对应岗位要求 #{item.requirement_id}
                                  </Badge>
                                )}
                                {item.origin === 'verification_fallback' && (
                                  <Badge variant="secondary">系统补齐的核实题</Badge>
                                )}
                              </div>
                            )}
                            {item.requirement_id && (
                              <p className="mb-2 text-sm text-muted-foreground">
                                {
                                  analysis.requirement_matches?.find(
                                    (match) => match.requirement_id === item.requirement_id,
                                  )?.text
                                }
                              </p>
                            )}
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
                        importing ||
                        loadingResume ||
                        verificationEditing
                      }
                      onClick={() => setSavingQuestions(true)}
                    >
                      挑选题目入库
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={!analysis.questions.length || analyzing || verificationEditing}
                      onClick={() => void copyQuestions()}
                    >
                      <Copy data-icon="inline-start" />
                      复制提纲
                    </Button>
                  </div>
                  {(questionNotice || questionsSaved) && (
                    <p className="ai-screening-notice" role="status">
                      {questionNotice ||
                        `本报告已有 ${analysis.saved_question_count ?? 0} 道题在题库中。`}{' '}
                      <a href="#question-bank">查看面试题库</a>
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
                {analysis.id && (
                  <ScreeningVerification
                    key={analysis.id}
                    reportId={analysis.id}
                    questions={analysis.questions}
                    initial={analysis.verifications}
                    disabled={
                      analyzing || importing || loadingResume || historyBusy || savingQuestions
                    }
                    onEditingChange={setVerificationEditing}
                    onRecordsChange={updateVerifications}
                  />
                )}
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
                      <td
                        className="whitespace-nowrap text-muted-foreground"
                        title="暂无经确认的评分规则，旧版模型估算分不作为有效匹配度展示。"
                      >
                        未评分
                      </td>
                      <td className="whitespace-nowrap">{analysisTime(row.created_at)}</td>
                      <td>{row.question_count}</td>
                      <td>
                        <div className="flex gap-1">
                          <Button
                            variant="link"
                            size="sm"
                            disabled={
                              historyBusy ||
                              analyzing ||
                              savingQuestions ||
                              importing ||
                              loadingResume ||
                              verificationEditing
                            }
                            onClick={() => void viewHistory(row)}
                          >
                            查看
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            disabled={
                              historyBusy || analyzing || savingQuestions || verificationEditing
                            }
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
      {savingQuestions && analysis?.id && (
        <AiQuestionSelection
          reportId={analysis.id}
          onClose={() => setSavingQuestions(false)}
          onSaved={(state, message) => {
            setAnalysis((current) =>
              current && current.id === analysis.id
                ? {
                    ...current,
                    saved_question_count: state.saved_question_count,
                    questions_saved: state.questions_saved,
                  }
                : current,
            );
            setQuestionNotice(message);
          }}
        />
      )}
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
              <h2 id="ai-confirm-title">删除分析记录</h2>
            </div>
            <div className="enterprise-dialog-body">
              <p id="ai-confirm-description">
                {`确定删除分析记录 ${confirmation.row.code} 吗？此操作不会删除已存入题库的题目。`}
              </p>
              {historyError && <ErrorNotice message={historyError} />}
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
              <Button type="submit" variant="destructive" disabled={savingQuestions || historyBusy}>
                {historyBusy ? '正在删除…' : '确认删除'}
              </Button>
            </div>
          </form>
        )}
      </dialog>
    </div>
  );
}
