import Popover from '@douyinfe/semi-ui/lib/es/popover';
import Tag from '@douyinfe/semi-ui/lib/es/tag';
import { ChevronDown } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { ApiError, api, type Job } from '@/lib/api';

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
    <span className="flex flex-wrap gap-1">
      {value.map((name) => (
        <Tag
          key={name}
          color={sites.find((site) => site.name === name)?.color ?? 'grey'}
          type="light"
        >
          {name}
        </Tag>
      ))}
    </span>
  );
}

export function RecruitmentSitesEditor({
  job,
  onSaved,
  disabled = false,
  onSavingChange,
}: {
  job: Job;
  onSaved: (job: Job) => void;
  disabled?: boolean;
  onSavingChange?: (saving: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState<string[] | null>(null);
  const pending = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const editable = job.permissions.edit && job.status !== 'closed';

  async function save(value: string[]) {
    const sameSites = (current: string[] = []) =>
      current.length === value.length && value.every((site) => current.includes(site));
    if (pending.current || disabled || !editable || sameSites(job.recruitment_sites)) return;
    pending.current = true;
    setSaving(true);
    onSavingChange?.(true);
    setError('');
    setSaved(false);
    setRetry(null);
    try {
      onSaved(
        await api<Job>(`jobs/${job.id}/recruitment-sites/`, {
          version: job.version,
          recruitment_sites: value,
        }),
      );
      setSaved(true);
    } catch (e) {
      // A response can be lost after the write. Read back before offering a retry.
      if (
        e instanceof ApiError &&
        (e.status === 0 ||
          (e.status >= 200 && e.status < 300) ||
          e.status === 409 ||
          e.status >= 500)
      ) {
        try {
          const current = await api<Job>(`jobs/${job.id}/`);
          onSaved(current);
          if (sameSites(current.recruitment_sites)) {
            setSaved(true);
            return;
          }
          if (current.version !== job.version) {
            setError('职位已更新，已显示最新内容，请重新选择。');
            return;
          }
        } catch {
          setError('暂时无法确认保存结果，请稍后重试。');
          setRetry(value);
          return;
        }
      }
      setError(`未保存：${(e as Error).message}`);
      setRetry(value);
    } finally {
      pending.current = false;
      setSaving(false);
      onSavingChange?.(false);
    }
  }

  if (!editable) return <RecruitmentSites value={job.recruitment_sites} />;
  return (
    <Popover
      trigger="click"
      position="bottomLeft"
      visible={open}
      motion={false}
      guardFocus
      closeOnEsc
      returnFocusOnClose
      onEscKeyDown={(event) => event.stopPropagation()}
      onVisibleChange={(visible) => {
        if (!pending.current) setOpen(visible);
      }}
      content={
        <div className="flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-3 p-4">
          <RecruitmentSitesField
            value={job.recruitment_sites ?? []}
            disabled={saving || disabled}
            onChange={(value) => void save(value)}
          />
          {error ? (
            <div role="alert" className="text-destructive text-xs">
              {error}
              {retry && (
                <Button
                  size="sm"
                  variant="link"
                  onClick={() => {
                    trigger.current?.focus({ preventScroll: true });
                    void save(retry);
                  }}
                >
                  重试
                </Button>
              )}
            </div>
          ) : (
            <p role="status" className="text-muted-foreground text-xs">
              {saving ? '正在保存…' : saved ? '已自动保存' : '选择后自动保存'}
            </p>
          )}
        </div>
      }
    >
      <Button
        ref={trigger}
        type="button"
        variant="outline"
        className="h-auto min-h-10 w-full justify-between gap-1 rounded-[10px] px-2 py-1.5 text-left whitespace-normal"
        aria-label={`设置${job.title}的招聘网站`}
        aria-expanded={open}
        aria-haspopup="dialog"
        disabled={disabled && !saving}
      >
        {job.recruitment_sites?.length ? (
          <RecruitmentSites value={job.recruitment_sites} />
        ) : (
          <span className="text-muted-foreground">选择网站</span>
        )}
        <ChevronDown data-icon="inline-end" />
      </Button>
    </Popover>
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
