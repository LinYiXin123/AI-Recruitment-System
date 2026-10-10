import { Badge } from '@/components/ui/badge';
import { kindLabel } from '@/lib/api';

export type RequirementMatch = {
  requirement_id: number;
  kind: 'must' | 'preferred' | 'exclusion';
  text: string;
  needs_verification: boolean;
  status: 'supported' | 'insufficient' | 'contradictory' | 'analysis_error';
  quote: string;
  quotes?: string[];
  reason: string;
  question: string;
  question_index: number | null;
};

export function RequirementMatchSummary({ items }: { items?: RequirementMatch[] }) {
  if (!items?.length) return null;
  const confirmed = items.filter((item) => !item.needs_verification);
  const supported = confirmed.filter(
    (item) => item.status === 'supported' && item.kind !== 'exclusion',
  ).length;
  const signals = confirmed.filter(
    (item) => item.status === 'supported' && item.kind === 'exclusion',
  ).length;
  return (
    <section className="flex flex-col gap-2" aria-label="岗位对照概览">
      <div className="flex flex-wrap gap-2">
        <Badge variant="success">材料支持 {supported} 项</Badge>
        <Badge variant="warning">
          信息不足 {confirmed.filter((i) => i.status === 'insufficient').length} 项
        </Badge>
        {items.length > confirmed.length && (
          <Badge variant="warning">岗位要求待确认 {items.length - confirmed.length} 项</Badge>
        )}
        {confirmed.some((i) => i.status === 'contradictory') && (
          <Badge variant="warning">
            材料矛盾待核实 {confirmed.filter((i) => i.status === 'contradictory').length} 项
          </Badge>
        )}
        {confirmed.some((i) => i.status === 'analysis_error') && (
          <Badge variant="destructive">
            分析需重试 {confirmed.filter((i) => i.status === 'analysis_error').length} 项
          </Badge>
        )}
        {signals > 0 && <Badge variant="warning">排除信号待核实 {signals} 项</Badge>}
      </div>
      <p className="text-sm text-muted-foreground">
        材料支持仅表示原文相关，仍需核实；信息不足不代表不符合要求。
      </p>
    </section>
  );
}

export function RequirementMatches({
  items,
  questions = [],
  showSummary = true,
}: {
  items?: RequirementMatch[];
  questions?: { requirement_id?: number | null }[];
  showSummary?: boolean;
}) {
  if (!items?.length)
    return (
      <p className="text-muted-foreground">
        此报告没有逐项对照记录。使用已生效的岗位画像重新分析后，可查看每条要求的材料依据。
      </p>
    );
  return (
    <section className="flex flex-col gap-3" aria-label="岗位要求与材料对照">
      <h3>岗位要求与材料对照</h3>
      {showSummary && <RequirementMatchSummary items={items} />}
      {items.map((item) => {
        const quotes = [
          ...new Set(item.quotes?.length ? item.quotes : item.quote ? [item.quote] : []),
        ];
        const indices = questions.flatMap((question, index) =>
          question.requirement_id === item.requirement_id ? [index] : [],
        );
        if (!indices.length && item.question_index != null) indices.push(item.question_index);
        return (
          <article key={item.requirement_id} className="flex flex-col gap-2 rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{kindLabel[item.kind]}</Badge>
              <Badge
                variant={
                  item.needs_verification
                    ? 'warning'
                    : item.status === 'analysis_error'
                      ? 'destructive'
                      : item.status === 'supported' && item.kind !== 'exclusion'
                        ? 'success'
                        : 'warning'
                }
              >
                {item.needs_verification
                  ? '岗位要求待确认'
                  : item.status === 'supported'
                    ? item.kind === 'exclusion'
                      ? '发现相关信号 · 待核实'
                      : '材料有依据'
                    : item.status === 'contradictory'
                      ? '材料矛盾待核实'
                      : item.status === 'analysis_error'
                        ? '分析需重试'
                        : '信息不足'}
              </Badge>
            </div>
            <p className="font-medium">{item.text}</p>
            <details>
              <summary className="cursor-pointer text-sm text-primary">
                查看材料依据与 AI 说明
              </summary>
              <div className="mt-2 flex flex-col gap-2">
                {quotes.map((quote) => (
                  <blockquote key={quote} className="border-l-2 pl-3 text-sm whitespace-pre-wrap">
                    简历原文：{quote}
                  </blockquote>
                ))}
                <p className="text-sm text-muted-foreground">{item.reason}</p>
                {item.question && <p className="text-sm">建议核实：{item.question}</p>}
                {indices.length > 0 && (
                  <p className="text-sm text-muted-foreground">
                    对应下方核实问题 {indices.map((i) => i + 1).join('、')}
                  </p>
                )}
                {item.question && !indices.length && (
                  <p className="text-sm text-muted-foreground">
                    本条未纳入本次主问题，可按上述问题另行核实。
                  </p>
                )}
              </div>
            </details>
          </article>
        );
      })}
    </section>
  );
}
