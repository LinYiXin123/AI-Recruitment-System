import { Bot, Crosshair, RotateCw, Sparkles, Trash2, Upload } from 'lucide-react';
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
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { api, type Job, type Page } from '@/lib/api';
import type { Application } from '@/lib/intake';

type ApplicationOption = Pick<Application, 'id' | 'candidate' | 'name'>;
type JobOption = Pick<Job, 'id' | 'title'>;
type CandidateOption = { id: number; name: string; applicationId: number };

async function allPages<T>(resource: string, signal: AbortSignal) {
  // ponytail: load authorized options in full for native selects; switch to server search if startup latency grows.
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
  const [analysisNotice, setAnalysisNotice] = useState('');
  const [historyNotice, setHistoryNotice] = useState('');
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
    setResume('');
    setResumeNotice('正在读取候选人的简历原文…');
    setAnalysisNotice('');
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
    if (!file) return;
    if (!file.size || file.size > 10 * 1024 * 1024) {
      setResumeNotice('请选择非空且不超过 10MB 的附件。');
      return;
    }
    if (!/\.(pdf|docx?|jpe?g|png|webp|txt|md)$/i.test(file.name)) {
      setResumeNotice('暂不支持该附件格式，请选择 PDF、Word、图片或文本文件。');
      return;
    }
    setAnalysisNotice('');
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
    setAnalysisNotice('');
    setHistoryNotice('');
    if (resumeInput.current) resumeInput.current.value = '';
  }

  function startAnalysis(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAnalysisNotice(
      resume.trim()
        ? 'AI 初面分析服务尚未接通，当前不会生成评分或面试结果。'
        : '请先填写或导入简历内容，再开始分析。',
    );
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
                <FieldLabel htmlFor="ai-candidate">选择候选人</FieldLabel>
                <NativeSelect
                  className="ai-screening-select"
                  id="ai-candidate"
                  value={selectedCandidate}
                  disabled={optionsLoading || Boolean(optionsError)}
                  onChange={(event) => {
                    const option = candidates.find(
                      (item) => String(item.id) === event.target.value,
                    );
                    setSelectedCandidate(event.target.value);
                    setSelectedApplication(option?.applicationId ?? null);
                  }}
                >
                  <NativeSelectOption value="">请选择候选人（可留空）</NativeSelectOption>
                  {candidates.map((candidate) => (
                    <NativeSelectOption key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="ai-job">目标职位</FieldLabel>
                <NativeSelect
                  className="ai-screening-select"
                  id="ai-job"
                  value={selectedJob}
                  disabled={optionsLoading || Boolean(optionsError)}
                  onChange={(event) => setSelectedJob(event.target.value)}
                >
                  <NativeSelectOption value="">请选择职位（可留空）</NativeSelectOption>
                  {jobs.map((job) => (
                    <NativeSelectOption key={job.id} value={String(job.id)}>
                      {job.title}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="ai-company">目标企业</FieldLabel>
                <NativeSelect className="ai-screening-select" id="ai-company" value="general">
                  <NativeSelectOption value="general">不指定企业（通用初判）</NativeSelectOption>
                </NativeSelect>
              </Field>
              <Field>
                <div className="ai-resume-heading">
                  <FieldLabel htmlFor="ai-resume">简历内容</FieldLabel>
                  <Button
                    className="ai-upload-button"
                    type="button"
                    variant="outline"
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
                    void importResume(event.dataTransfer.files[0]);
                  }}
                >
                  <legend className="sr-only">简历附件拖放区</legend>
                  <Textarea
                    id="ai-resume"
                    className="ai-screening-textarea"
                    value={resume}
                    onChange={(event) => {
                      setResume(event.target.value);
                      setResumeNotice('');
                      setAnalysisNotice('');
                    }}
                    placeholder="选择候选人后会自动带出其简历原文，也可直接粘贴新内容"
                    aria-label="简历内容"
                  />
                </fieldset>
                <p className="ai-screening-help">
                  选择候选人后自动填充其「简历原文」，可覆盖修改；可选 PDF / Word /
                  图片附件（≤10MB），附件解析尚未接通，也可直接拖入文本文件。
                </p>
                {resumeNotice && (
                  <p className="ai-screening-notice" role="status">
                    {resumeNotice}
                  </p>
                )}
              </Field>
            </FieldGroup>
            <div className="ai-screening-actions">
              <Button className="ai-start-button" type="submit">
                <Sparkles data-icon="inline-start" />
                开始分析
              </Button>
              <Button type="button" variant="ghost" onClick={clearForm}>
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
            <Empty className="ai-result-empty">
              <EmptyHeader>
                <EmptyMedia className="ai-empty-icon">
                  <Crosshair aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>尚未发起分析</EmptyTitle>
                <EmptyDescription>左侧填写后点击「开始分析」</EmptyDescription>
              </EmptyHeader>
              <p className="ai-screening-help">
                正式 AI 分析服务尚未接通，当前不会生成评分或面试结果。
              </p>
              {analysisNotice && (
                <p className="ai-screening-notice" role="status">
                  {analysisNotice}
                </p>
              )}
            </Empty>
          </div>
        </section>
      </div>

      <section
        className="dashboard-card ai-screening-card ai-history-card"
        aria-labelledby="ai-history-title"
      >
        <header className="dashboard-card-head">
          <h2 id="ai-history-title">历史分析记录</h2>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setHistoryNotice('历史分析服务尚未接通，当前无法刷新记录。')}
          >
            <RotateCw data-icon="inline-start" />
            刷新
          </Button>
        </header>
        <Empty className="ai-history-empty">
          <EmptyHeader>
            <EmptyMedia className="ai-empty-icon">
              <Bot aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>还没有 AI 初面记录</EmptyTitle>
            <EmptyDescription>正式分析服务接通后，历史结果会显示在这里。</EmptyDescription>
          </EmptyHeader>
          {historyNotice && (
            <p className="ai-screening-notice" role="status">
              {historyNotice}
            </p>
          )}
        </Empty>
      </section>
    </div>
  );
}
