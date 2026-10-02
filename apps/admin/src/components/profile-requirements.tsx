import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { kindLabel, type Requirement } from '@/lib/api';

export type EditableRequirement = Requirement & { key: string };

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
        <FieldSet key={r.key} className="requirement-editor" disabled={busy}>
          <FieldLegend>要求 {i + 1}</FieldLegend>
          <div className="flex items-center justify-between gap-3">
            <FieldLabel id={`kind-label-${r.key}`} htmlFor={`kind-${r.key}`} className="sr-only">
              要求 {i + 1} 类型
            </FieldLabel>
            <NativeSelect
              id={`kind-${r.key}`}
              aria-labelledby={`kind-label-${r.key}`}
              disabled={busy}
              value={r.kind}
              onChange={(e) => update(r.key, { kind: e.target.value as Requirement['kind'] })}
            >
              {Object.entries(kindLabel).map(([value, label]) => (
                <NativeSelectOption key={value} value={value}>
                  {label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`删除要求 ${i + 1}`}
              disabled={busy || requirements.length <= 1}
              onClick={() => onChange(requirements.filter((item) => item.key !== r.key))}
            >
              <Trash2 />
            </Button>
          </div>
          <Field>
            <FieldLabel htmlFor={`req-${r.key}`}>具体要求 {i + 1}</FieldLabel>
            <Textarea
              id={`req-${r.key}`}
              value={r.text}
              onChange={(e) => update(r.key, { text: e.target.value })}
              maxLength={1000}
              required
              placeholder="写清楚可核对的能力、经历或工作条件。"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`why-${r.key}`}>
              岗位关系与依据{r.kind !== 'exclusion' ? '（可选）' : ''}
            </FieldLabel>
            <Input
              id={`why-${r.key}`}
              value={r.rationale}
              onChange={(e) => update(r.key, { rationale: e.target.value })}
              maxLength={1000}
              required={r.kind === 'exclusion'}
            />
          </Field>
          <Field orientation="horizontal">
            <input
              id={`verify-${r.key}`}
              type="checkbox"
              checked={r.needs_verification}
              onChange={(e) => update(r.key, { needs_verification: e.target.checked })}
            />
            <FieldLabel htmlFor={`verify-${r.key}`}>此项仍需核实，不能直接作为淘汰依据</FieldLabel>
          </Field>
          {r.source_quote && <p className="source-note">原始依据：{r.source_quote}</p>}
        </FieldSet>
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
