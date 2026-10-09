import Tag from '@douyinfe/semi-ui/lib/es/tag';
import { useId } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';

const sites = [
  { name: 'BOSS直聘', color: 'green' },
  { name: '猎聘', color: 'orange' },
  { name: '智联招聘', color: 'blue' },
  { name: '前程无忧', color: 'violet' },
  { name: '拉勾招聘', color: 'cyan' },
  { name: '其他', color: 'grey' },
] as const;

export function RecruitmentSites({ value = [] }: { value?: string[] }) {
  if (!value.length) return <>—</>;
  return (
    <div className="flex flex-wrap gap-1">
      {value.map((name) => (
        <Tag
          key={name}
          color={sites.find((site) => site.name === name)?.color ?? 'grey'}
          type="light"
        >
          {name}
        </Tag>
      ))}
    </div>
  );
}

export function RecruitmentSitesField({
  value,
  onChange,
  disabled = false,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <FieldSet disabled={disabled}>
      <FieldLegend variant="label">招聘网站（可多选）</FieldLegend>
      <FieldGroup className="grid grid-cols-2 gap-3">
        {sites.map((site, index) => (
          <Field key={site.name} orientation="horizontal" data-disabled={disabled}>
            <Checkbox
              id={`${id}-${index}`}
              disabled={disabled}
              checked={value.includes(site.name)}
              onCheckedChange={(checked) =>
                onChange(
                  checked ? [...value, site.name] : value.filter((name) => name !== site.name),
                )
              }
            />
            <FieldLabel htmlFor={`${id}-${index}`}>{site.name}</FieldLabel>
          </Field>
        ))}
      </FieldGroup>
    </FieldSet>
  );
}
