import { Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ErrorNotice } from '@/components/feedback';
import { type RequirementMatch, RequirementMatches } from '@/components/requirement-matches';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { ApiError, api, dateTime } from '@/lib/api';
import type { Application } from '@/lib/intake';
import {
  ScreeningQualityNotice,
  type ScreeningSource,
  ScreeningSourceDetails,
  ScreeningVerification,
  type Verification,
} from './ai-screening-verification';

export type ProfileAnalysis = {
  id: number;
  code: string;
  created_at: string;
  summary: string;
  quality_version?: number;
  analysis_date?: string | null;
  analysis_issues?: string[];
  requirement_matches: RequirementMatch[];
  source_context: ScreeningSource | null;
  source_status?: { profile_stale: boolean | null; material_stale: boolean | null };
  questions: {
    question: string;
    follow_up: string;
    answer_points: string[];
    requirement_id?: number | null;
    origin?: 'generated' | 'verification_fallback';
  }[];
  verifications: Verification[];
};

export function ApplicationProfile({
  application,
  disabled,
  onBusyChange,
  onEditingChange,
}: {
  application: Application;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onEditingChange: (editing: boolean) => void;
}) {
  const available = application.resumes.filter(
    (r) => r.parse?.status === 'succeeded' && r.parse.text.trim(),
  );
  const [parseId, setParseId] = useState(() => String(available[0]?.parse?.id ?? ''));
  const [report, setReport] = useState<ProfileAnalysis | null>(
    application.profile_analysis ?? null,
  );
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [verificationBusy, setVerificationBusy] = useState(false);
  const [error, setError] = useState('');
  const retry = useRef<{ signature: string; key: string } | null>(null);
  const inFlight = useRef(false);
  const incoming = useRef(application);
  const selected = available.find((r) => String(r.parse?.id) === parseId)?.parse;
  useEffect(() => {
    if (incoming.current === application || busy || editing) return;
    incoming.current = application;
    setReport(application.profile_analysis ?? null);
  }, [application, busy, editing]);
  useEffect(() => {
    setParseId((current) => {
      const usable = application.resumes.filter(
        (r) => r.parse?.status === 'succeeded' && r.parse.text.trim(),
      );
      return usable.some((r) => String(r.parse?.id) === current)
        ? current
        : String(usable[0]?.parse?.id ?? '');
    });
  }, [application.resumes]);
  useEffect(() => {
    onBusyChange(busy || verificationBusy);
    return () => onBusyChange(false);
  }, [busy, verificationBusy, onBusyChange]);
  useEffect(() => {
    onEditingChange(editing);
    return () => onEditingChange(false);
  }, [editing, onEditingChange]);
  // A review refresh may also observe a newer profile/material version in the same drawer.
  const profileStale =
    report?.source_status?.profile_stale ||
    (report?.source_context?.job?.profile_id != null &&
      report.source_context.job.profile_id !== application.profile);
  const materialStale = report?.source_status?.material_stale;
  const sourceUnknown =
    (report?.source_status?.profile_stale == null &&
      report?.source_context?.job?.profile_id == null) ||
    materialStale == null;
  const differentMaterial = Boolean(
    selected && report && report.source_context?.source.resume_parse_id !== selected.id,
  );

  async function analyze() {
    if (!selected || inFlight.current || disabled || editing) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    const signature = `${application.id}:${application.version}:${application.profile}:${selected.id}:${selected.text}`;
    if (retry.current?.signature !== signature)
      retry.current = { signature, key: crypto.randomUUID() };
    try {
      const next = await api<ProfileAnalysis>('ai-screenings/', {
        request_key: retry.current.key,
        application_id: application.id,
        job_id: application.job,
        resume_parse_id: selected.id,
        resume: selected.text,
      });
      setReport(next);
      retry.current = null;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) retry.current = null;
      setError((e as Error).message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-lg border p-4" aria-label="候选人画像分析">
      <div>
        <h3>候选人画像 · AI 对照岗位要求</h3>
        <p className="text-sm text-muted-foreground">
          AI 只提示简历证据和待核实项，不给录用或淘汰结论。
        </p>
      </div>
      {!application.profile ? (
        <p>此职位尚未启用岗位画像。先在岗位画像中核对要求并保存使用。</p>
      ) : !available.length ? (
        <p>暂时没有可分析的简历文字。请在候选人库补充本次应聘的材料，完成解析后再分析。</p>
      ) : (
        <>
          <Field>
            <FieldLabel htmlFor="profile-resume" id="profile-resume-label">
              本次分析材料
            </FieldLabel>
            <NativeSelect
              id="profile-resume"
              aria-labelledby="profile-resume-label"
              value={parseId}
              disabled={busy || disabled || editing}
              onChange={(e) => setParseId(e.target.value)}
            >
              {available.map((r) => (
                <NativeSelectOption key={r.parse?.id} value={String(r.parse?.id)}>
                  {r.name} · 文字 v{r.parse?.version}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <FieldDescription>每次分析一份简历；结果保留当时的岗位和材料版本。</FieldDescription>
          </Field>
          <Button
            className="self-start"
            disabled={busy || disabled || editing || !selected}
            onClick={analyze}
          >
            <Sparkles data-icon="inline-start" />
            {busy ? '正在对照岗位要求…' : report ? '重新分析当前材料' : 'AI 分析候选人画像'}
          </Button>
        </>
      )}
      {busy && (
        <p role="status" className="text-sm text-muted-foreground">
          AI 正在提取原文依据与待核实问题，请稍候。
        </p>
      )}
      {error && <ErrorNotice message={error} />}
      {report && (
        <>
          <p className="text-sm text-muted-foreground">
            报告 {report.code} · {dateTime(report.created_at)} · 仅本人可见
          </p>
          {differentMaterial && (
            <Alert>
              <AlertTitle>当前所选材料尚未分析</AlertTitle>
              <AlertDescription>
                下方是先前材料的报告。点击“重新分析当前材料”生成对应结果，或切回原材料继续核实。
              </AlertDescription>
            </Alert>
          )}
          {(profileStale || materialStale) && (
            <Alert>
              <AlertTitle>分析依据已更新</AlertTitle>
              <AlertDescription>
                {profileStale ? '岗位标准已改变。' : ''}
                {materialStale ? '应聘材料已改变。' : ''}
                下方保留历史结论，请重新分析后再用于当前复核。
              </AlertDescription>
            </Alert>
          )}
          {sourceUnknown && (
            <Alert>
              <AlertTitle>旧报告来源信息不完整</AlertTitle>
              <AlertDescription>
                旧报告缺少版本信息，无法确认是否仍适用，请重新分析。
              </AlertDescription>
            </Alert>
          )}
          <ScreeningQualityNotice report={report} />
          <h4>AI 预分析</h4>
          <p className="whitespace-pre-wrap">{report.summary}</p>
          <RequirementMatches items={report.requirement_matches} questions={report.questions} />
          <ScreeningSourceDetails source={report.source_context} />
          <ScreeningVerification
            key={report.id}
            reportId={report.id}
            questions={report.questions}
            initial={report.verifications}
            disabled={busy || disabled || differentMaterial}
            onEditingChange={setEditing}
            onBusyChange={setVerificationBusy}
          />
        </>
      )}
    </section>
  );
}
