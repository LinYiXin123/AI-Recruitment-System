import { ArrowDown, ArrowUp, Copy, Printer, X } from 'lucide-react';
import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ErrorNotice } from '@/components/feedback';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';

export type GuideEntry = {
  id: number;
  version: number;
  content: string;
  job_title: string;
  dimension: string;
  difficulty: string;
  reference_answer: string;
  follow_up: string;
};

export function QuestionGuide({
  open,
  entries,
  setEntries,
  onClose,
}: {
  open: boolean;
  entries: GuideEntry[];
  setEntries: Dispatch<SetStateAction<GuideEntry[]>>;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const busyRef = useRef(false);
  const requestRef = useRef<AbortController | null>(null);
  const [title, setTitle] = useState('面试提纲');
  const [includeAnswers, setIncludeAnswers] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => () => requestRef.current?.abort(), []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && !dialog?.open) {
      setError('');
      setNotice('');
      dialog?.showModal();
    } else if (!open && dialog?.open) dialog.close();
  }, [open]);

  const text = [
    title.trim() || '面试提纲',
    `共 ${entries.length} 题`,
    ...entries.map((entry, index) =>
      [
        `${index + 1}. ${entry.content}`,
        `适用职位：${entry.job_title || '通用'} · 考察维度：${entry.dimension || '未分类'} · 难度：${entry.difficulty}`,
        entry.follow_up.trim() && `临时追问：${entry.follow_up.trim()}`,
        includeAnswers && entry.reference_answer && `参考答案要点：\n${entry.reference_answer}`,
      ]
        .filter(Boolean)
        .join('\n'),
    ),
  ].join('\n\n');

  function move(index: number, offset: number) {
    setEntries((current) => {
      const next = [...current];
      [next[index], next[index + offset]] = [next[index + offset], next[index]];
      return next;
    });
    setNotice(`已将第 ${index + 1} 题移至第 ${index + offset + 1} 位。`);
  }

  async function output(print: boolean) {
    if (busyRef.current || !entries.length) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      // 导出前重新核验，避免跨页选中的旧题或已失去权限的题目继续输出。
      const latest = await Promise.all(
        entries.map((entry) =>
          api<GuideEntry>(`question-templates/${entry.id}/`, undefined, controller.signal),
        ),
      );
      if (controller.signal.aborted) return;
      const changed = latest.findIndex((entry, index) => entry.version !== entries[index].version);
      if (changed >= 0) {
        throw new Error(`第 ${changed + 1} 题已更新，请移除后从题库重新选择，再复制或打印。`);
      }
      if (print) {
        window.print();
      } else {
        try {
          await navigator.clipboard.writeText(text);
          setNotice('提纲已复制，可粘贴到面试准备文档中。');
        } catch {
          throw new Error('无法访问剪贴板，请展开“查看完整提纲”后手动复制，或选择打印。');
        }
      }
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(`未能${print ? '打印' : '复制'}提纲：${(failure as Error).message}`);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <dialog
        ref={dialogRef}
        className="question-bank-dialog question-guide-dialog"
        aria-labelledby="question-guide-title"
        onCancel={(event) => {
          event.preventDefault();
          if (!busyRef.current) onClose();
        }}
      >
        <div className="question-guide-layout">
          <div className="question-bank-dialog-heading">
            <h2 id="question-guide-title">面试提纲</h2>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="关闭面试提纲"
              disabled={busy}
              onClick={onClose}
            >
              <X />
            </Button>
          </div>
          <div className="question-bank-dialog-body">
            <p className="question-guide-hint">
              已选 {entries.length} 题。可调整顺序并补充临时追问；离开题库页面前请复制或打印。
            </p>
            {error && <ErrorNotice message={error} />}
            {notice && (
              <p role="status" className="question-bank-form-notice">
                {notice}
              </p>
            )}
            <fieldset disabled={busy}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="question-guide-name">提纲名称</FieldLabel>
                  <Input
                    id="question-guide-name"
                    maxLength={120}
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </Field>
                <Field orientation="horizontal">
                  <Checkbox
                    id="question-guide-answers"
                    checked={includeAnswers}
                    onCheckedChange={setIncludeAnswers}
                  />
                  <FieldLabel htmlFor="question-guide-answers">包含参考答案</FieldLabel>
                </Field>
                {entries.map((entry, index) => (
                  <article
                    key={entry.id}
                    className="question-guide-entry"
                    aria-label={`第 ${index + 1} 题`}
                  >
                    <div className="question-guide-entry-heading">
                      <h3>第 {index + 1} 题</h3>
                      <div className="question-guide-entry-actions">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={busy || index === 0}
                          aria-label={`上移第 ${index + 1} 题`}
                          onClick={() => move(index, -1)}
                        >
                          <ArrowUp />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={busy || index === entries.length - 1}
                          aria-label={`下移第 ${index + 1} 题`}
                          onClick={() => move(index, 1)}
                        >
                          <ArrowDown />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          aria-label={`移除第 ${index + 1} 题`}
                          onClick={() =>
                            setEntries((current) => current.filter((item) => item.id !== entry.id))
                          }
                        >
                          移除
                        </Button>
                      </div>
                    </div>
                    <p className="question-guide-content">{entry.content}</p>
                    <p className="question-guide-hint">
                      {entry.job_title || '通用'} · {entry.dimension || '未分类'} ·{' '}
                      {entry.difficulty}
                    </p>
                    <Field>
                      <FieldLabel htmlFor={`question-guide-follow-${entry.id}`}>
                        第 {index + 1} 题临时追问
                      </FieldLabel>
                      <Textarea
                        id={`question-guide-follow-${entry.id}`}
                        maxLength={2000}
                        placeholder="仅用于这份提纲，原题保持不变"
                        value={entry.follow_up}
                        onChange={(event) =>
                          setEntries((current) =>
                            current.map((item) =>
                              item.id === entry.id
                                ? { ...item, follow_up: event.target.value }
                                : item,
                            ),
                          )
                        }
                      />
                    </Field>
                    {includeAnswers && entry.reference_answer && (
                      <details>
                        <summary>参考答案要点</summary>
                        <p className="question-guide-content">{entry.reference_answer}</p>
                      </details>
                    )}
                  </article>
                ))}
              </FieldGroup>
            </fieldset>
            {!entries.length && <p>暂未选择题目，请返回题库勾选。</p>}
            {!!entries.length && (
              <details>
                <summary>查看完整提纲</summary>
                <pre className="question-guide-content">{text}</pre>
              </details>
            )}
          </div>
          <div className="question-bank-dialog-footer">
            <Button variant="outline" disabled={busy} onClick={onClose}>
              继续选题
            </Button>
            <Button
              variant="outline"
              disabled={busy || !entries.length}
              onClick={() => void output(true)}
            >
              <Printer data-icon="inline-start" />
              打印提纲
            </Button>
            <Button disabled={busy || !entries.length} onClick={() => void output(false)}>
              <Copy data-icon="inline-start" />
              {busy ? '核验中…' : '复制提纲'}
            </Button>
          </div>
        </div>
      </dialog>
      {open &&
        createPortal(
          <div className="question-bank-print">
            <pre>{text}</pre>
          </div>,
          document.body,
        )}
    </>
  );
}
