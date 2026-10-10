import { Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ErrorNotice } from '@/components/feedback';
import {
  type RequirementMatch,
  RequirementMatches,
  RequirementMatchSummary,
} from '@/components/requirement-matches';
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
  report,
  onReportChange,
  onDifferentMaterialChange,
  disabled,
  onBusyChange,
}: {
  application: Application;
  report: ProfileAnalysis | null;
  onReportChange: (report: ProfileAnalysis | null) => void;
  onDifferentMaterialChange: (different: boolean) => void;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const available = application.resumes.filter(
    (r) => r.parse?.status === 'succeeded' && r.parse.text.trim(),
  );
  const [parseId, setParseId] = useState(() => String(available[0]?.parse?.id ?? ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const retry = useRef<{ signature: string; key: string } | null>(null);
  const inFlight = useRef(false);
  const selected = available.find((r) => String(r.parse?.id) === parseId)?.parse;
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
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);
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
  useEffect(() => {
    onDifferentMaterialChange(differentMaterial);
  }, [differentMaterial, onDifferentMaterialChange]);

  async function analyze() {
    if (!selected || inFlight.current || disabled) return;
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
      onReportChange(next);
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
              disabled={busy || disabled}
              onChange={(e) => setParseId(e.target.value)}
            >
              {available.map((r) => (
                <NativeSelectOption key={r.parse?.id} value={String(r.parse?.id)}>
                  {r.name} · 文字 v{r.parse?.version}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <FieldDescription>报告保留所选简历及岗位要求版本。</FieldDescription>
          </Field>
          <Button className="self-start" disabled={busy || disabled || !selected} onClick={analyze}>
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
          <RequirementMatchSummary items={report.requirement_matches} />
          <ScreeningQualityNotice report={report} />
          {report.summary && (
            <details className="rounded-lg border p-3">
              <summary className="cursor-pointer">查看 AI 分析摘要</summary>
              <p className="mt-3 whitespace-pre-wrap">{report.summary}</p>
            </details>
          )}
        </>
      )}
    </section>
  );
}

export function ApplicationProfileComparison({
  application,
  report,
  differentMaterial,
  disabled,
  onBusyChange,
  onEditingChange,
}: {
  application: Application;
  report: ProfileAnalysis | null;
  differentMaterial: boolean;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onEditingChange: (editing: boolean) => void;
}) {
  if (!report)
    return (
      <section className="rounded-lg border p-4" aria-label="岗位对照详情">
        <p>还没有岗位对照。请先在“应聘概览”选择简历并开始 AI 对照。</p>
      </section>
    );
  const profileStale =
    report.source_status?.profile_stale ||
    (report.source_context?.job?.profile_id != null &&
      report.source_context.job.profile_id !== application.profile);
  const materialStale = report.source_status?.material_stale;
  const sourceUnknown =
    (report.source_status?.profile_stale == null &&
      report.source_context?.job?.profile_id == null) ||
    materialStale == null;
  return (
    <section className="flex flex-col gap-4" aria-label="岗位对照详情">
      {(differentMaterial || profileStale || materialStale || sourceUnknown) && (
        <Alert>
          <AlertTitle>对照结果需要留意</AlertTitle>
          <AlertDescription>
            {differentMaterial
              ? '当前选择的简历尚未分析；下方仍是先前材料的对照。'
              : profileStale
                ? '岗位标准已变化；下方保留旧标准的分析结果。'
                : materialStale
                  ? '应聘材料已变化；下方保留旧材料的分析结果。'
                  : '旧报告的来源信息不完整，无法确认是否仍适用。'}{' '}
            请回到“应聘概览”重新分析后再用于复核。
          </AlertDescription>
        </Alert>
      )}
      <RequirementMatches
        items={report.requirement_matches}
        questions={report.questions}
        showSummary={false}
      />
      <ScreeningSourceDetails source={report.source_context} />
      <ScreeningVerification
        key={report.id}
        reportId={report.id}
        questions={report.questions}
        initial={report.verifications}
        disabled={disabled || differentMaterial}
        onEditingChange={onEditingChange}
        onBusyChange={onBusyChange}
      />
    </section>
  );
}
