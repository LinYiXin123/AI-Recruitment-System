import { Badge } from '@/components/ui/badge';
import { kindLabel } from '@/lib/api';
import type { Verification } from '@/pages/ai-screening-verification';

export type RequirementMatch = {
  requirement_id: number;
  kind: 'must' | 'preferred' | 'exclusion';
  text: string;
  needs_verification: boolean;
  status: 'supported' | 'insufficient';
  quote: string;
  reason: string;
  question: string;
  question_index: number | null;
};

export function RequirementMatches({
  items,
  verifications = [],
  questions = [],
}: {
  items?: RequirementMatch[];
  verifications?: Verification[];
  questions?: { requirement_id?: number | null }[];
}) {
  if (!items?.length)
    return (
      <p className="text-muted-foreground">
        此报告没有逐项对照记录。使用已生效的岗位画像重新分析后，可查看每条要求的材料依据。
      </p>
    );
  const supported = items.filter(
    (item) => item.status === 'supported' && item.kind !== 'exclusion' && !item.needs_verification,
  ).length;
  const signals = items.filter(
    (item) => item.status === 'supported' && item.kind === 'exclusion',
  ).length;
  return (
    <section className="flex flex-col gap-3" aria-label="岗位要求与材料对照">
      <div className="flex flex-col gap-2">
        <h3>岗位要求与材料对照</h3>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">材料支持 {supported} 项</Badge>
          <Badge variant="outline">
            信息不足 {items.filter((i) => i.status === 'insufficient').length} 项
          </Badge>
          {signals > 0 && <Badge variant="outline">排除信号待核实 {signals} 项</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">
          材料支持表示简历中有相关原文，不代表能力已核实。信息不足不等于不符合要求。
        </p>
      </div>
      {items.map((item) => {
        const indices = questions.flatMap((question, index) =>
          question.requirement_id === item.requirement_id ? [index] : [],
        );
        if (!indices.length && item.question_index != null) indices.push(item.question_index);
        const records = verifications.filter(
          (v) => indices.includes(v.question_index) && v.status !== 'withdrawn',
        );
        return (
          <article key={item.requirement_id} className="flex flex-col gap-2 rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{kindLabel[item.kind]}</Badge>
              <Badge
                variant={
                  item.status === 'supported' && item.kind !== 'exclusion' ? 'secondary' : 'outline'
                }
              >
                {item.needs_verification
                  ? '岗位要求待确认'
                  : item.status === 'supported'
                    ? item.kind === 'exclusion'
                      ? '发现相关信号 · 待核实'
                      : '材料有依据'
                    : '信息不足'}
              </Badge>
            </div>
            <p className="font-medium">{item.text}</p>
            {item.quote && (
              <blockquote className="border-l-2 pl-3 text-sm whitespace-pre-wrap">
                简历原文：{item.quote}
              </blockquote>
            )}
            <p className="text-sm text-muted-foreground">{item.reason}</p>
            {item.question && <p className="text-sm">建议核实：{item.question}</p>}
            {indices.length > 0 && (
              <p className="text-sm text-muted-foreground">
                对应下方核实问题 {indices.map((i) => i + 1).join('、')}
              </p>
            )}
            {records.map((verified) => (
              <div key={verified.id} className="rounded-md bg-muted p-2 text-sm">
                <p>
                  人工核实：
                  {
                    {
                      pending: '待核实',
                      supported: '有依据支持',
                      contradicted: '与材料不符',
                      unresolved: '仍待补充',
                      withdrawn: '已撤回',
                    }[verified.status]
                  }
                </p>
                <p className="text-muted-foreground">
                  问题 {verified.question_index + 1} · {verified.recorder_name}
                </p>
                {verified.evidence && (
                  <p className="whitespace-pre-wrap">依据：{verified.evidence}</p>
                )}
                {verified.next_step && <p>下一步：{verified.next_step}</p>}
              </div>
            ))}
          </article>
        );
      })}
    </section>
  );
}
