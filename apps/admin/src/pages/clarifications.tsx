import { useEffect, useState } from 'react';
import { Blank, ErrorNotice, Loading, Pager } from '@/components/feedback';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel, FieldSet } from '@/components/ui/field';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { api, type Clarification, dateTime, type Job, type Page } from '@/lib/api';

export function Clarifications({
  job,
  busy,
  setBusy,
  dirty,
  saved,
  failed,
}: {
  job: Job;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  dirty: (dirty: boolean) => void;
  saved: (job: Job, message: string) => void;
  failed: (error: string) => void;
}) {
  const [data, setData] = useState<Page<Clarification> | null>(null);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [question, setQuestion] = useState('');
  const [requirement, setRequirement] = useState('');
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [answer, setAnswer] = useState('');
  const [answering, setAnswering] = useState<number | null>(null);
  const p = job.latest_profile;
  useEffect(() => {
    const c = new AbortController();
    setError('');
    setData(null);
    api<Page<Clarification>>(`jobs/${job.id}/clarifications/?page=${page}`, undefined, c.signal)
      .then(setData)
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message);
      });
    return () => c.abort();
  }, [job.id, job.version, page, reload]);
  async function submit(endpoint: string, body: Record<string, unknown>, message: string) {
    if (busy) return;
    setBusy(true);
    failed('');
    try {
      const result = await api<Job>(`jobs/${job.id}/${endpoint}/`, {
        version: job.version,
        ...body,
      });
      setQuestion('');
      setRequirement('');
      setAnswer('');
      setAnswering(null);
      setRequestKey(crypto.randomUUID());
      setPage(1);
      saved(result, message);
    } catch (e) {
      failed((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="section-heading">
        <div>
          <h2>先问清楚，再完善岗位要求</h2>
          <p>问题和答复保留在原版本。回答不会自动启用画像，也不会替 HR 修改要求。</p>
        </div>
      </div>
      {job.permissions.edit &&
        p?.status === 'draft' &&
        job.status !== 'closed' &&
        answering === null && (
          <form
            onChange={() => dirty(true)}
            onSubmit={(e) => {
              e.preventDefault();
              void submit(
                'clarifications',
                {
                  profile: p.id,
                  requirement: Number(requirement),
                  question,
                  request_key: requestKey,
                },
                '问题已交给负责人，工作台待办已创建。',
              );
            }}
          >
            <FieldSet disabled={busy} className="rounded-xl border p-4">
              <FieldGroup>
                <Field>
                  <FieldLabel
                    id="clarification-requirement-label"
                    htmlFor="clarification-requirement"
                  >
                    需要澄清哪条要求（必填）
                  </FieldLabel>
                  <NativeSelect
                    aria-labelledby="clarification-requirement-label"
                    id="clarification-requirement"
                    disabled={busy}
                    required
                    value={requirement}
                    onChange={(e) => setRequirement(e.target.value)}
                  >
                    <NativeSelectOption value="" disabled>
                      选择 v{p.number} 中的一条要求
                    </NativeSelectOption>
                    {p.requirements.map((r, i) => (
                      <NativeSelectOption key={r.id} value={r.id}>
                        {i + 1}. {r.text}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
                <Field>
                  <FieldLabel htmlFor="clarification-question">
                    想向负责人了解什么（必填）
                  </FieldLabel>
                  <Textarea
                    id="clarification-question"
                    required
                    value={question}
                    maxLength={1000}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder="例如：独立负责过哪类项目，才算满足这项要求？"
                  />
                </Field>
                <p className="text-muted-foreground">
                  回答人：{job.approver_name} · 请先保存草稿中的要求，再针对具体内容提问。
                </p>
                <Button type="submit" disabled={busy}>
                  {busy ? '正在保存…' : '提交澄清问题'}
                </Button>
              </FieldGroup>
            </FieldSet>
          </form>
        )}
      {error ? (
        <ErrorNotice message={error} retry={() => setReload((n) => n + 1)} />
      ) : !data ? (
        <Loading />
      ) : (
        <>
          {data.count === 0 && (
            <Blank
              title="尚未发起澄清问题"
              description="HR 保存要求草稿后，可将不明确的部分交给指定负责人回答。"
            />
          )}
          {data.results.map((q) => (
            <section
              key={q.id}
              className="rounded-xl border p-4 space-y-3"
              aria-label={`澄清问题：${q.question}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">v{q.profile_number}</Badge>
                <Badge variant="secondary">
                  {{ pending: '待回答', answered: '已回答', withdrawn: '已撤回' }[q.status]}
                </Badge>
              </div>
              <p className="whitespace-pre-wrap break-words text-muted-foreground">
                对应要求：{q.requirement_text}
              </p>
              <h3 className="whitespace-pre-wrap break-words">{q.question}</h3>
              <p className="text-xs text-muted-foreground">
                {q.requester_name} · {dateTime(q.created_at)} 提问 · 交给 {q.assignee_name}
              </p>
              {q.status === 'answered' && (
                <div className="review-note">
                  <strong>{q.assignee_name} 的答复</strong>
                  <p className="whitespace-pre-wrap break-words">{q.answer}</p>
                  <small>
                    {q.answered_at && dateTime(q.answered_at)} · 仅回答问题，仍需 HR 核对后使用
                  </small>
                </div>
              )}
              {q.status === 'withdrawn' && <p>该草稿已被替代或职位已关闭，请以当前版本为准。</p>}
              {q.can_answer &&
                (answering === q.id ? (
                  <form
                    onChange={() => dirty(true)}
                    onSubmit={(e) => {
                      e.preventDefault();
                      void submit(
                        `clarifications/${q.id}/answer`,
                        { answer },
                        '答复已保存，HR 将核对要求后自行保存并使用。',
                      );
                    }}
                  >
                    <FieldSet disabled={busy}>
                      <FieldGroup>
                        <Field>
                          <FieldLabel htmlFor={`answer-${q.id}`}>你的答复（必填）</FieldLabel>
                          <Textarea
                            id={`answer-${q.id}`}
                            required
                            maxLength={2000}
                            value={answer}
                            onChange={(e) => setAnswer(e.target.value)}
                          />
                        </Field>
                        <Button type="submit" disabled={busy}>
                          {busy ? '正在保存…' : '保存答复'}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => {
                            if (answer.trim() && !window.confirm('答复尚未保存，确定取消作答吗？'))
                              return;
                            setAnswer('');
                            setAnswering(null);
                            dirty(false);
                          }}
                        >
                          取消作答
                        </Button>
                      </FieldGroup>
                    </FieldSet>
                  </form>
                ) : (
                  <Button
                    disabled={busy}
                    variant="outline"
                    onClick={() => {
                      if (
                        (answer.trim() || question.trim() || requirement) &&
                        !window.confirm('当前内容尚未保存，确定改答这条问题吗？')
                      )
                        return;
                      setAnswer('');
                      setQuestion('');
                      setRequirement('');
                      setAnswering(q.id);
                      dirty(false);
                    }}
                  >
                    回答这个问题
                  </Button>
                ))}
            </section>
          ))}
          {data.count > 20 && (
            <Pager
              page={page}
              count={data.count}
              onChange={(next) => {
                if ((question || answer) && !window.confirm('尚有未保存的内容，确定切换页码吗？'))
                  return;
                setQuestion('');
                setRequirement('');
                setAnswer('');
                setAnswering(null);
                dirty(false);
                setPage(next);
              }}
            />
          )}
        </>
      )}
    </>
  );
}
