import Select from '@douyinfe/semi-ui/lib/es/select';
import { Bot, Crosshair, Sparkles, Trash2, Upload } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { ErrorNotice } from '@/components/feedback';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { api, type Job, type Page } from '@/lib/api';
import type { Application } from '@/lib/intake';

type ApplicationOption = Pick<Application, 'id' | 'candidate' | 'name'>;
type JobOption = Pick<Job, 'id' | 'title'>;
type CandidateOption = { id: number; name: string; applicationId: number };
type ScreeningResult = {
  summary: string;
  evidence: { criterion: string; quote: string; reason: string }[];
  gaps: { criterion: string; note: string }[];
  questions: { question: string; reason: string }[];
  limitations: string;
};

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
  const [selectedCandidate, setSelectedCandidate] = useState('');
  const [selectedApplication, setSelectedApplication] = useState<number | null>(null);
  const [selectedJob, setSelectedJob] = useState('');
  const [resume, setResume] = useState('');
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState('');
  const [optionsRevision, setOptionsRevision] = useState(0);
  const [resumeNotice, setResumeNotice] = useState('');
  const [analysis, setAnalysis] = useState<ScreeningResult | null>(null);
  const [analysisError, setAnalysisError] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const resumeInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setOptionsLoading(true);
    setOptionsError('');
    Promise.all([
      allPages<ApplicationOption>('applications/', controller.signal),
      allPages<JobOption>('jobs/', controller.signal),
    ])
      .then(([applications, jobRows]) => {
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
    if (selectedApplication === null) return;
    const controller = new AbortController();
    setAnalysis(null);
    setAnalysisError('');
    setResume('');
    setResumeNotice('正在读取候选人的简历原文…');
    api<Application>(`applications/${selectedApplication}/`, undefined, controller.signal)
      .then((application) => {
        const source = application.resumes.find((item) => item.parse?.text.trim())?.parse?.text;
        if (source) {
          setResume(source);
          setResumeNotice('已填入候选人的简历原文，可继续修改。');
        } else {
          setResumeNotice('暂时没有可用的简历原文，请直接粘贴简历内容。');
        }
      })
      .catch((error: Error) => {
        if (error.name !== 'AbortError')
          setResumeNotice('简历原文暂时无法读取，请直接粘贴简历内容。');
      });
    return () => controller.abort();
  }, [selectedApplication]);

  async function importResume(file?: File) {
    if (!file || analyzing) return;
    if (!file.size || file.size > 10 * 1024 * 1024) {
      setResumeNotice('请选择非空且不超过 10MB 的附件。');
      return;
    }
    if (!/\.(pdf|docx?|jpe?g|png|webp|txt|md)$/i.test(file.name)) {
      setResumeNotice('暂不支持该附件格式，请选择 PDF、Word、图片或文本文件。');
      return;
    }
    setAnalysis(null);
    setAnalysisError('');
    if (/\.(txt|md)$/i.test(file.name)) {
      try {
        setResume(await file.text());
        setResumeNotice(`已导入 ${file.name}，可继续修改简历内容。`);
      } catch {
        setResumeNotice('无法读取该附件，请直接粘贴简历内容。');
      }
      return;
    }
    setResumeNotice(`已选择 ${file.name}。附件解析服务尚未接通，请直接粘贴简历原文。`);
  }

  function clearForm() {
    setSelectedCandidate('');
    setSelectedApplication(null);
    setSelectedJob('');
    setResume('');
    setResumeNotice('');
    setAnalysis(null);
    setAnalysisError('');
    if (resumeInput.current) resumeInput.current.value = '';
  }

  async function startAnalysis(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resume.trim()) {
      setAnalysisError('请先填写或导入简历内容。');
      return;
    }
    setAnalysis(null);
    setAnalysisError('');
    setAnalyzing(true);
    try {
      setAnalysis(
        await api<ScreeningResult>('ai-screenings/', {
          application_id: selectedApplication,
          job_id: selectedJob ? Number(selectedJob) : null,
          resume,
        }),
      );
    } catch (error) {
      setAnalysisError((error as Error).message);
    } finally {
      setAnalyzing(false);
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
                  disabled={optionsLoading || Boolean(optionsError) || analyzing}
                  clickToHide
                  dropdownClassName="candidate-select-dropdown"
                  onChange={(value) => {
                    const candidateId = typeof value === 'string' ? value : '';
                    const option = candidates.find((item) => String(item.id) === candidateId);
                    setSelectedCandidate(candidateId);
                    setSelectedApplication(option?.applicationId ?? null);
                    setAnalysis(null);
                    setAnalysisError('');
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
                  disabled={optionsLoading || Boolean(optionsError) || analyzing}
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
                  value="general"
                  disabled={analyzing}
                  clickToHide
                  dropdownClassName="candidate-select-dropdown"
                >
                  <Select.Option value="general">不指定企业（通用初判）</Select.Option>
                </Select>
              </Field>
              <Field>
                <div className="ai-resume-heading">
                  <FieldLabel htmlFor="ai-resume">简历内容</FieldLabel>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={analyzing}
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
                    accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp,.txt,.md"
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
                    if (analyzing) return;
                    void importResume(event.dataTransfer.files[0]);
                  }}
                >
                  <legend className="sr-only">简历附件拖放区</legend>
                  <Textarea
                    id="ai-resume"
                    className="ai-screening-textarea"
                    value={resume}
                    disabled={analyzing}
                    onChange={(event) => {
                      setResume(event.target.value);
                      setResumeNotice('');
                      setAnalysis(null);
                      setAnalysisError('');
                    }}
                    placeholder="选择候选人后会自动带出其简历原文，也可直接粘贴新内容"
                    aria-label="简历内容"
                  />
                </fieldset>
                <p className="ai-screening-help">
                  选择候选人后自动填充其「简历原文」，可覆盖修改；也可导入简历附件（PDF / Word /
                  图片，≤10MB）或直接拖入文本文件。
                </p>
                {resumeNotice && (
                  <p className="ai-screening-notice" role="status">
                    {resumeNotice}
                  </p>
                )}
              </Field>
            </FieldGroup>
            <div className="ai-screening-actions">
              <Button type="submit" size="lg" disabled={analyzing}>
                <Sparkles data-icon="inline-start" />
                {analyzing ? '正在分析…' : '开始分析'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="lg"
                onClick={clearForm}
                disabled={analyzing}
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
          <div className="ai-result-content">
            {analyzing ? (
              <p className="ai-screening-help p-6 text-center" role="status">
                正在分析简历与职位要求，请稍候…
              </p>
            ) : analysisError ? (
              <p className="p-6 text-center text-destructive" role="alert">
                {analysisError}
              </p>
            ) : analysis ? (
              <div className="space-y-5 p-5">
                <p className="rounded-lg border bg-secondary px-3 py-2 text-sm font-medium text-foreground">
                  AI 辅助整理 · 请由 HR 复核
                </p>
                <p className="text-sm leading-7 text-foreground">{analysis.summary}</p>
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-foreground">简历依据</h3>
                  {analysis.evidence.length ? (
                    analysis.evidence.map((item) => (
                      <div
                        key={`${item.criterion}-${item.quote}`}
                        className="rounded-lg border p-3"
                      >
                        <p className="text-sm font-medium">{item.criterion}</p>
                        <blockquote className="my-2 border-l-2 pl-3 text-sm text-muted-foreground">
                          {item.quote}
                        </blockquote>
                        <p className="text-sm text-muted-foreground">{item.reason}</p>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      模型未返回可核验的简历原文依据。
                    </p>
                  )}
                </section>
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-foreground">待核实信息</h3>
                  {analysis.gaps.length ? (
                    analysis.gaps.map((item) => (
                      <p
                        key={`${item.criterion}-${item.note}`}
                        className="text-sm text-muted-foreground"
                      >
                        <span className="font-medium text-foreground">{item.criterion}：</span>
                        {item.note}
                      </p>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">模型未列出待核实信息。</p>
                  )}
                </section>
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-foreground">建议面试追问</h3>
                  {analysis.questions.length ? (
                    analysis.questions.map((item) => (
                      <div key={`${item.question}-${item.reason}`} className="text-sm">
                        <p className="font-medium text-foreground">{item.question}</p>
                        <p className="text-muted-foreground">{item.reason}</p>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">模型未返回面试追问。</p>
                  )}
                </section>
                <p className="border-t pt-3 text-xs leading-5 text-muted-foreground">
                  {analysis.limitations}
                </p>
              </div>
            ) : (
              <Empty className="ai-result-empty">
                <EmptyHeader>
                  <EmptyMedia className="ai-empty-icon">
                    <Crosshair aria-hidden="true" />
                  </EmptyMedia>
                  <EmptyTitle>尚未发起分析</EmptyTitle>
                  <EmptyDescription>左侧填写后点击「开始分析」</EmptyDescription>
                </EmptyHeader>
                <p className="ai-screening-help">分析不提供录用或淘汰结论，也不会自动评分。</p>
              </Empty>
            )}
          </div>
        </section>
      </div>

      <section
        className="dashboard-card ai-screening-card ai-history-card"
        aria-labelledby="ai-history-title"
      >
        <header className="dashboard-card-head">
          <h2 id="ai-history-title">历史分析记录</h2>
        </header>
        <Empty className="ai-history-empty">
          <EmptyHeader>
            <EmptyMedia className="ai-empty-icon">
              <Bot aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>历史记录暂未保存</EmptyTitle>
            <EmptyDescription>本次分析结果只在当前页面展示，刷新后不会保留。</EmptyDescription>
          </EmptyHeader>
          <p className="ai-screening-help">历史留存与访问范围确认后再接入。</p>
        </Empty>
      </section>
    </div>
  );
}
