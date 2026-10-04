import { Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ErrorNotice } from '@/components/feedback';
import {
  type EditableRequirement,
  ProfileRequirementSummary,
  ProfileRequirements,
} from '@/components/profile-requirements';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { api, type Job, type Me } from '@/lib/api';
import { ProfileAi, type ProfileGeneration } from '@/pages/talent-profiles';

export function ProfileDraft({
  me,
  close,
  created,
}: {
  me: Me;
  close: () => void;
  created: (job: Job) => void;
}) {
  const [step, setStep] = useState<'input' | 'review' | 'save'>('input');
  const [jd, setJd] = useState('');
  const [goal, setGoal] = useState('');
  const [generation, setGeneration] = useState<ProfileGeneration | null>(null);
  const [requirements, setRequirements] = useState<EditableRequirement[]>([]);
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [headcount, setHeadcount] = useState(1);
  const [department, setDepartment] = useState(me.departments[0]?.id ?? 0);
  const [approver, setApprover] = useState('');
  const [requestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const field = step === 'input' ? '#draft-need' : step === 'save' ? '#draft-title' : 'summary';
    formRef.current?.scrollTo({ top: 0 });
    formRef.current?.querySelector<HTMLElement>(field)?.focus({ preventScroll: true });
  }, [step]);
  const d = me.departments.find((item) => item.id === department);
  const unverified = requirements.some((r) => r.kind === 'must' && r.needs_verification);
  const matchesInput =
    !generation ||
    (generation.input.jd === jd.trim() && generation.input.business_goal === goal.trim());
  function requestClose() {
    if (
      !busy &&
      (!(jd || goal || generation) || window.confirm('画像尚未保存为职位，确定关闭吗？'))
    )
      close();
  }
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) requestClose();
      }}
    >
      <SheetContent side="top" className="profile-settings-dialog">
        <SheetHeader className="profile-settings-header">
          <SheetTitle className="flex items-center gap-2">
            <Sparkles aria-hidden="true" />
            AI 起草岗位画像
          </SheetTitle>
          <SheetDescription>
            先说清楚要招什么人，AI 帮你拆成可核对的要求。由你修改、决定是否使用。
          </SheetDescription>
        </SheetHeader>
        <form
          ref={formRef}
          id="profile-draft-form"
          className="profile-settings-body"
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy) return;
            if (step === 'review') {
              setStep('save');
              return;
            }
            if (step !== 'save' || !requirements.length || !matchesInput) return;
            setBusy(true);
            setError('');
            try {
              const activate =
                (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'activate';
              created(
                await api<Job>('jobs/', {
                  request_id: requestId,
                  title,
                  location,
                  headcount,
                  department,
                  approver: Number(approver),
                  jd: jd.trim(),
                  profile: {
                    generation_id: generation?.id ?? null,
                    business_goal: goal.trim(),
                    source: generation ? 'AI 起草，HR 核对' : 'HR 手工整理',
                    activate,
                    requirements: requirements.map(({ key: _key, ...item }) => item),
                  },
                }),
              );
            } catch (e) {
              setError((e as Error).message);
              setBusy(false);
            }
          }}
        >
          <ol className="mt-5 flex flex-wrap gap-4 text-sm" aria-label="起草步骤">
            {(['input', 'review', 'save'] as const).map((value, i) => (
              <li
                key={value}
                aria-current={step === value ? 'step' : undefined}
                className={step === value ? 'font-semibold text-primary' : 'text-muted-foreground'}
              >
                {i + 1}. {['描述需求', '核对画像', '保存并使用'][i]}
              </li>
            ))}
          </ol>
          <FieldSet disabled={busy}>
            <FieldGroup>
              {step === 'input' ? (
                <>
                  <Field>
                    <FieldLabel htmlFor="draft-need">你想招什么样的人？</FieldLabel>
                    <Textarea
                      id="draft-need"
                      className="min-h-48"
                      rows={8}
                      maxLength={30000}
                      value={jd}
                      onChange={(e) => setJd(e.target.value)}
                      placeholder="粘贴已有招聘需求，或用自己的话描述。例如：招一名渠道经理，负责寻找合作伙伴、推进签约，并能用数据复盘项目结果……"
                    />
                    <FieldDescription>
                      生成预览不会创建职位，也不会自动启用岗位标准。
                    </FieldDescription>
                  </Field>
                  <details>
                    <summary className="cursor-pointer text-muted-foreground">
                      补充业务目标（可选）
                    </summary>
                    <Field className="mt-3">
                      <FieldLabel htmlFor="draft-goal">希望入职后完成什么？</FieldLabel>
                      <Textarea
                        id="draft-goal"
                        value={goal}
                        maxLength={5000}
                        rows={3}
                        onChange={(e) => setGoal(e.target.value)}
                      />
                    </Field>
                  </details>
                  <ProfileAi
                    jd={jd}
                    businessGoal={goal}
                    busy={busy}
                    setBusy={setBusy}
                    restoreInput={(input) => {
                      setJd(input.jd);
                      setGoal(input.business_goal);
                    }}
                    adopt={(result, items) => {
                      setGeneration(result);
                      setRequirements(items.map((r) => ({ ...r, key: crypto.randomUUID() })));
                      setError('');
                      setStep('review');
                    }}
                  />
                  {!matchesInput && (
                    <p role="status">
                      招聘需求或业务目标已修改，原草稿需要重新生成并采用。已整理的要求仍保留；恢复原输入可继续核对。
                    </p>
                  )}
                  {requirements.length > 0 && matchesInput && (
                    <Button type="button" variant="outline" onClick={() => setStep('review')}>
                      继续核对已整理的画像
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="link"
                    disabled={busy || !jd.trim()}
                    onClick={() => {
                      setGeneration(null);
                      setRequirements([
                        {
                          key: crypto.randomUUID(),
                          kind: 'must',
                          text: '',
                          rationale: '',
                          needs_verification: false,
                        },
                      ]);
                      setStep('review');
                    }}
                  >
                    手动整理要求
                  </Button>
                </>
              ) : step === 'review' ? (
                <>
                  <ProfileRequirementSummary requirements={requirements} />
                  <FieldDescription>
                    逐项修改要求、查看原始依据；待核实的必须项需明确后才能使用。保存前不会创建职位。
                  </FieldDescription>
                  <ProfileRequirements
                    requirements={requirements}
                    busy={busy}
                    onChange={setRequirements}
                  />
                </>
              ) : (
                <>
                  <p>画像已核对，补充以下必要信息即可保存。职位管理会共用这份职位和画像。</p>
                  <FieldGroup className="grid gap-4 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="draft-title">职位名称</FieldLabel>
                      <Input
                        id="draft-title"
                        value={title}
                        maxLength={100}
                        required
                        onChange={(e) => setTitle(e.target.value)}
                      />
                    </Field>
                    <Field>
                      <FieldLabel id="draft-department-label" htmlFor="draft-department">
                        所属部门
                      </FieldLabel>
                      <NativeSelect
                        id="draft-department"
                        disabled={busy}
                        aria-labelledby="draft-department-label"
                        className="w-full"
                        value={department}
                        onChange={(e) => {
                          setDepartment(Number(e.target.value));
                          setApprover('');
                        }}
                      >
                        {me.departments.map((item) => (
                          <NativeSelectOption key={item.id} value={item.id}>
                            {item.name}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="draft-location">工作地点</FieldLabel>
                      <Input
                        id="draft-location"
                        value={location}
                        maxLength={100}
                        required
                        onChange={(e) => setLocation(e.target.value)}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="draft-headcount">招聘人数</FieldLabel>
                      <Input
                        id="draft-headcount"
                        type="number"
                        min={1}
                        max={32767}
                        value={headcount}
                        required
                        onChange={(e) => setHeadcount(Number(e.target.value))}
                      />
                    </Field>
                    <Field className="sm:col-span-2">
                      <FieldLabel id="draft-approver-label" htmlFor="draft-approver">
                        用人负责人（用于澄清）
                      </FieldLabel>
                      <NativeSelect
                        id="draft-approver"
                        disabled={busy}
                        aria-labelledby="draft-approver-label"
                        className="w-full"
                        value={approver}
                        required
                        onChange={(e) => setApprover(e.target.value)}
                      >
                        <NativeSelectOption value="" disabled>
                          选择用人负责人
                        </NativeSelectOption>
                        {d?.approvers.map((item) => (
                          <NativeSelectOption key={item.id} value={item.id}>
                            {item.name}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                      <FieldDescription>
                        {d?.approvers.length
                          ? '仅用于需求澄清。画像由你直接保存使用，无需其审批。'
                          : '本部门尚未配置用人负责人，请联系管理员授权。'}
                      </FieldDescription>
                    </Field>
                  </FieldGroup>
                  <FieldDescription>
                    保存会创建一个草稿职位并关联这份画像；不会发布招聘，也不会通知候选人。
                  </FieldDescription>
                  {unverified && (
                    <p role="status">必须项仍待核实，可先保存为草稿，完善后再使用。</p>
                  )}
                </>
              )}
              {error && <ErrorNotice message={error} />}
            </FieldGroup>
          </FieldSet>
        </form>
        <SheetFooter className="profile-settings-footer">
          {step === 'input' ? (
            <Button type="button" variant="outline" disabled={busy} onClick={requestClose}>
              取消
            </Button>
          ) : (
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setStep(step === 'save' ? 'review' : 'input');
                  setError('');
                }}
              >
                上一步
              </Button>
              {step === 'review' ? (
                <Button type="submit" form="profile-draft-form" disabled={busy}>
                  继续：补充职位信息
                </Button>
              ) : (
                <>
                  <Button
                    type="submit"
                    form="profile-draft-form"
                    variant="outline"
                    value="draft"
                    disabled={busy || !d?.approvers.length}
                  >
                    保存为草稿
                  </Button>
                  <Button
                    type="submit"
                    form="profile-draft-form"
                    value="activate"
                    disabled={busy || unverified || !d?.approvers.length}
                  >
                    {busy ? '正在保存…' : '保存并使用'}
                  </Button>
                </>
              )}
            </div>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
