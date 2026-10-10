import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { kindLabel, type Requirement } from '@/lib/api';

export type EditableRequirement = Requirement & { key: string };
const categories = {
  education: '学历门槛',
  experience: '工作年限',
  industry: '行业背景',
  skill: '技能',
  other: '其他要求',
} as const;

export function ProfileRequirementSummary({ requirements }: { requirements: Requirement[] }) {
  return (
    <section className="flex flex-wrap gap-2" aria-label="岗位要求摘要" aria-live="polite">
      <Badge variant="secondary">必备 {requirements.filter((r) => r.kind === 'must').length}</Badge>
      <Badge variant="secondary">
        加分 {requirements.filter((r) => r.kind === 'preferred').length}
      </Badge>
      <Badge variant="outline">
        排除信号 {requirements.filter((r) => r.kind === 'exclusion').length}
      </Badge>
      <Badge variant="warning">
        要求未确定 {requirements.filter((r) => r.needs_verification).length}
      </Badge>
    </section>
  );
}

function RequirementCard({
  requirement: r,
  index,
  busy,
  canDelete,
  update,
  remove,
}: {
  requirement: EditableRequirement;
  index: number;
  busy: boolean;
  canDelete: boolean;
  update: (change: Partial<Requirement>) => void;
  remove: () => void;
}) {
  const [expanded, setExpanded] = useState(
    !r.text.trim() || r.needs_verification || (r.kind === 'exclusion' && !r.rationale.trim()),
  );
  return (
    <details
      className="rounded-lg border bg-background p-4"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
      onInvalidCapture={(event) => {
        // 原生表单校验聚焦前同步展开，避免折叠中的必填字段无法访问。
        event.currentTarget.open = true;
        setExpanded(true);
      }}
    >
      <summary
        className="cursor-pointer rounded-sm leading-relaxed focus-visible:outline-ring"
        aria-label={`展开或收起要求 ${index}`}
      >
        <Badge variant={r.kind === 'must' ? 'secondary' : 'outline'}>{kindLabel[r.kind]}</Badge>{' '}
        <span className="break-words">{r.text || `要求 ${index}：填写具体要求`}</span>{' '}
        {r.needs_verification && <Badge variant="warning">要求未确定</Badge>}
      </summary>
      <FieldSet className="mt-4" disabled={busy}>
        <FieldGroup>
          <div className="flex items-center justify-between gap-3">
            <div className="flex gap-2">
              <FieldLabel
                id={`category-label-${r.key}`}
                htmlFor={`category-${r.key}`}
                className="sr-only"
              >
                要求 {index} 内容类别
              </FieldLabel>
              <NativeSelect
                id={`category-${r.key}`}
                aria-labelledby={`category-label-${r.key}`}
                disabled={busy}
                value={r.category ?? 'other'}
                onChange={(e) => update({ category: e.target.value as Requirement['category'] })}
              >
                {Object.entries(categories).map(([value, label]) => (
                  <NativeSelectOption key={value} value={value}>
                    {label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <FieldLabel id={`kind-label-${r.key}`} htmlFor={`kind-${r.key}`} className="sr-only">
                要求 {index} 类型
              </FieldLabel>
              <NativeSelect
                id={`kind-${r.key}`}
                aria-labelledby={`kind-label-${r.key}`}
                disabled={busy}
                value={r.kind}
                onChange={(e) => update({ kind: e.target.value as Requirement['kind'] })}
              >
                {Object.entries(kindLabel).map(([value, label]) => (
                  <NativeSelectOption key={value} value={value}>
                    {label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`删除要求 ${index}`}
              disabled={busy || !canDelete}
              onClick={remove}
            >
              <Trash2 />
            </Button>
          </div>
          <Field>
            <FieldLabel htmlFor={`req-${r.key}`}>具体要求 {index}</FieldLabel>
            <Textarea
              id={`req-${r.key}`}
              value={r.text}
              onChange={(e) => {
                e.currentTarget.setCustomValidity(e.target.value.trim() ? '' : '请填写具体要求。');
                update({ text: e.target.value });
              }}
              maxLength={1000}
              required
              placeholder="写清楚可核对的能力、经历或工作条件。"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`why-${r.key}`}>
              为什么需要这项要求{r.kind !== 'exclusion' ? '（可选）' : ''}
            </FieldLabel>
            <Input
              id={`why-${r.key}`}
              value={r.rationale}
              onChange={(e) => update({ rationale: e.target.value })}
              maxLength={1000}
              required={r.kind === 'exclusion'}
              pattern={r.kind === 'exclusion' ? '.*\\S.*' : undefined}
            />
          </Field>
          <Field orientation="horizontal">
            <input
              id={`verify-${r.key}`}
              type="checkbox"
              aria-describedby={r.needs_verification ? `verify-help-${r.key}` : undefined}
              checked={r.needs_verification}
              onChange={(e) => update({ needs_verification: e.target.checked })}
            />
            <FieldLabel htmlFor={`verify-${r.key}`}>这条招人要求还没确定</FieldLabel>
          </Field>
          {r.needs_verification && (
            <FieldDescription id={`verify-help-${r.key}`}>
              请先确认岗位是否需要这项要求。确定后取消勾选；这不是在判断某位候选人是否符合。
            </FieldDescription>
          )}
          {r.source_quote && <p className="source-note">原始依据：{r.source_quote}</p>}
        </FieldGroup>
      </FieldSet>
    </details>
  );
}

export function ProfileRequirements({
  requirements,
  busy,
  onChange,
}: {
  requirements: EditableRequirement[];
  busy: boolean;
  onChange: (next: EditableRequirement[]) => void;
}) {
  function update(key: string, change: Partial<Requirement>) {
    onChange(requirements.map((r) => (r.key === key ? { ...r, ...change } : r)));
  }

  return (
    <>
      {requirements.map((r, i) => (
        <RequirementCard
          key={r.key}
          requirement={r}
          index={i + 1}
          busy={busy}
          canDelete={requirements.length > 1}
          update={(change) => update(r.key, change)}
          remove={() => onChange(requirements.filter((item) => item.key !== r.key))}
        />
      ))}
      <Button
        type="button"
        variant="outline"
        disabled={busy || requirements.length >= 50}
        onClick={() =>
          onChange([
            ...requirements,
            {
              key: crypto.randomUUID(),
              kind: 'preferred',
              category: 'skill',
              text: '',
              rationale: '',
              needs_verification: false,
            },
          ])
        }
      >
        <Plus data-icon="inline-start" />
        添加一项要求
      </Button>
    </>
  );
}
