import Table from '@douyinfe/semi-ui/lib/es/table';
import Select from '@douyinfe/semi-ui/lib/es/select';
import { BriefcaseBusiness, Search } from 'lucide-react';
import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { Blank, ErrorNotice, Loading, Pager } from '@/components/feedback';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { api, dateTime, type Page, type Person } from '@/lib/api';
import type { Application } from '@/lib/intake';

type Interview = {
  id: number;
  application: number;
  candidate_name: string;
  job_title: string;
  round_no: number;
  purpose: string;
  status: string;
  organizer_name: string;
  invitation_status: 'not_sent';
  revision: {
    id: number;
    version: number;
    starts_at: string;
    ends_at: string;
    timezone: string;
    mode: 'onsite' | 'video' | 'phone';
    location: string;
    meeting_url: string;
    status: string;
    participants: { id: number; name: string; required: boolean; duty: string }[];
  } | null;
};

const interviewStatus: Record<string, string> = {
  unscheduled: '未排期',
  pending_confirmation: '待确认',
  confirmed: '已确认',
  completed: '已完成',
  cancelled: '已取消',
};

const interviewMode: Record<NonNullable<Interview['revision']>['mode'], string> = {
  onsite: '现场面试',
  video: '视频面试',
  phone: '电话面试',
};

export type InterviewActions = {
  exportModule: () => void;
};

function toBeijingISOString(value: string) {
  const withSeconds = value.length === 16 ? `${value}:00` : value;
  return `${withSeconds}+08:00`;
}

export const Interviews = forwardRef<InterviewActions, { revision: number }>(function Interviews(
  { revision },
  ref,
) {
  const [data, setData] = useState<Page<Interview> | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [round, setRound] = useState('');
  const [mode, setMode] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [exporting, setExporting] = useState(false);

  const query = new URLSearchParams({ page: String(page) });
  if (search) query.set('search', search);
  if (round) query.set('round', round);
  if (mode) query.set('mode', mode);
  if (status) query.set('status', status);
  const interviewUrl = `interviews/?${query.toString()}`;

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError('');
    api<Page<Interview>>(interviewUrl, undefined, controller.signal)
      .then(setData)
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message);
      });
    return () => controller.abort();
  }, [interviewUrl, reload, revision]);

  function resetFilters() {
    setSearch('');
    setRound('');
    setMode('');
    setStatus('');
    setPage(1);
  }

  async function exportModule() {
    if (exporting) return;
    setExporting(true);
    setNotice('');
    try {
      const exportQuery = new URLSearchParams(query);
      exportQuery.delete('page');
      const rows: Interview[] = [];
      let currentPage = 1;
      let total = 0;
      do {
        const response = await api<Page<Interview>>(
          `interviews/?${exportQuery.toString()}&page=${currentPage}`,
        );
        total = response.count;
        rows.push(...response.results);
        currentPage += 1;
      } while (rows.length < total);
      const csv = [
        ['候选人', '职位', '面试轮次', '开始时间（北京时间）', '面试方式', '面试官', '场次状态'],
        ...rows.map((item) => [
          item.candidate_name,
          item.job_title,
          `第 ${item.round_no} 轮`,
          item.revision ? dateTime(item.revision.starts_at) : '未排期',
          item.revision ? interviewMode[item.revision.mode] : '—',
          item.revision?.participants.map((person) => person.name).join('、') || '—',
          interviewStatus[item.status] || item.status,
        ]),
      ]
        .map((row) => row.map((cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(','))
        .join('\r\n');
      const url = URL.createObjectURL(
        new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = '面试管理.csv';
      link.click();
      URL.revokeObjectURL(url);
      setNotice(`已导出当前授权范围内的 ${rows.length} 条面试记录。`);
    } catch (e) {
      setNotice(`导出未完成：${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
  }

  useImperativeHandle(ref, () => ({ exportModule: () => void exportModule() }));

  return (
    <>
      {notice && (
        <Alert className="candidate-library-notice">
          <AlertTitle>面试管理提示</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}
      <section className="panel interview-library-panel" aria-label="面试管理">
        <div className="interview-filterbar">
          <div className="interview-search">
            <Search aria-hidden="true" />
            <Input
              aria-label="搜索面试记录"
              placeholder="搜索..."
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </div>
          <Select
            className="interview-filter-select"
            aria-label="筛选面试轮次"
            value={round}
            onChange={(value) => {
              setRound(typeof value === 'string' ? value : '');
              setPage(1);
            }}
            clickToHide
            dropdownClassName="candidate-select-dropdown"
          >
            <Select.Option value="">全部</Select.Option>
            {[1, 2, 3, 4].map((value) => (
              <Select.Option key={value} value={String(value)}>
                第 {value} 轮
              </Select.Option>
            ))}
          </Select>
          <Select
            className="interview-filter-select"
            aria-label="筛选面试方式"
            value={mode}
            onChange={(value) => {
              setMode(typeof value === 'string' ? value : '');
              setPage(1);
            }}
            clickToHide
            dropdownClassName="candidate-select-dropdown"
          >
            <Select.Option value="">全部</Select.Option>
            {Object.entries(interviewMode).map(([value, label]) => (
              <Select.Option key={value} value={value}>
                {label}
              </Select.Option>
            ))}
          </Select>
          <Select
            className="interview-filter-select"
            aria-label="筛选场次状态"
            value={status}
            onChange={(value) => {
              setStatus(typeof value === 'string' ? value : '');
              setPage(1);
            }}
            clickToHide
            dropdownClassName="candidate-select-dropdown"
          >
            <Select.Option value="">全部</Select.Option>
            {Object.entries(interviewStatus)
              .filter(([value]) => value !== 'unscheduled')
              .map(([value, label]) => (
                <Select.Option key={value} value={value}>
                  {label}
                </Select.Option>
              ))}
          </Select>
          <Button type="button" variant="outline" size="sm" onClick={resetFilters}>
            重置
          </Button>
        </div>
        {error ? (
          <ErrorNotice message={error} retry={() => setReload((old) => old + 1)} />
        ) : !data ? (
          <Loading />
        ) : data.count === 0 ? (
          <Empty className="candidate-library-empty">
            <EmptyHeader>
              <EmptyMedia className="candidate-library-empty-icon">
                <BriefcaseBusiness aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>还没有数据</EmptyTitle>
              <EmptyDescription>
                点击右上角「新增面试记录」，在候选人详情安排第一场面试。
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <div className="table-container">
              <Table<Interview>
                rowKey="id"
                dataSource={data.results}
                pagination={false}
                columns={[
                  { title: '候选人', dataIndex: 'candidate_name', width: 140 },
                  { title: '职位', dataIndex: 'job_title', width: 170 },
                  { title: '轮次', width: 70, render: (_, row) => `第 ${row.round_no} 轮` },
                  {
                    title: '时间',
                    width: 145,
                    render: (_, row) => (row.revision ? dateTime(row.revision.starts_at) : '未排期'),
                  },
                  {
                    title: '方式',
                    width: 100,
                    render: (_, row) => (row.revision ? interviewMode[row.revision.mode] : '—'),
                  },
                  {
                    title: '面试官',
                    width: 150,
                    render: (_, row) =>
                      row.revision?.participants.map((person) => person.name).join('、') || '—',
                  },
                  {
                    title: '状态',
                    width: 130,
                    render: (_, row) => (
                      <div className="flex flex-col items-start gap-1">
                        <Badge variant="secondary">
                          {interviewStatus[row.status] || row.status}
                        </Badge>
                        {row.invitation_status === 'not_sent' && <small>邀请尚未发送</small>}
                      </div>
                    ),
                  },
                ]}
              />
            </div>
            <Pager count={data.count} page={page} onChange={setPage} />
          </>
        )}
      </section>
    </>
  );
});

export function ScheduleInterview({
  application,
  dirty,
  setDirty,
  scheduled,
}: {
  application: Application;
  dirty: boolean;
  setDirty: (value: boolean) => void;
  scheduled: () => void;
}) {
  const [round, setRound] = useState('1');
  const [purpose, setPurpose] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [mode, setMode] = useState<NonNullable<Interview['revision']>['mode']>('onsite');
  const [location, setLocation] = useState('');
  const [meetingUrl, setMeetingUrl] = useState('');
  const [participants, setParticipants] = useState<Set<number>>(() => new Set());
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function changed() {
    setDirty(true);
    setError('');
    setRequestKey(crypto.randomUUID());
  }

  function toggle(person: Person, checked: boolean) {
    changed();
    setParticipants((old) => {
      const next = new Set(old);
      if (checked) next.add(person.id);
      else next.delete(person.id);
      return next;
    });
  }

  if (application.stage !== 'ready_to_schedule') return null;
  return (
    <section className="panel schedule-panel">
      <div className="section-heading">
        <div>
          <h3>安排面试</h3>
          <p>保存前由服务端检查候选人与所有面试官的系统内时间冲突。</p>
        </div>
        <Badge variant="outline">第 1 轮起</Badge>
      </div>
      <p className="source-note">
        当前仅保存系统内排期，不会发送邀请或要求候选人确认。邀请、确认和改期会在后续流程单独处理。
      </p>
      {error && <ErrorNotice message={error} />}
      {!application.interviewers.length ? (
        <Blank
          title="暂无可选面试官"
          description="请由管理员为本部门配置有效面试官职责后再安排，当前不会创建不完整预约。"
        />
      ) : (
        <form
          className="flex flex-col gap-5"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError('');
            try {
              await api<Interview>('interviews/', {
                application: application.id,
                version: application.version,
                request_key: requestKey,
                round_no: Number(round),
                purpose,
                starts_at: toBeijingISOString(startsAt),
                ends_at: toBeijingISOString(endsAt),
                timezone: 'Asia/Shanghai',
                mode,
                location,
                meeting_url: meetingUrl,
                participants: [...participants],
              });
              setDirty(false);
              scheduled();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <FieldSet disabled={busy}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="interview-round">面试轮次</FieldLabel>
                <Input
                  id="interview-round"
                  type="number"
                  min={1}
                  max={99}
                  required
                  value={round}
                  onChange={(e) => {
                    changed();
                    setRound(e.target.value);
                  }}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="interview-purpose">本轮目标</FieldLabel>
                <Textarea
                  id="interview-purpose"
                  required
                  maxLength={200}
                  value={purpose}
                  onChange={(e) => {
                    changed();
                    setPurpose(e.target.value);
                  }}
                  placeholder="例如：核实需求分析方法与跨团队协作经历"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="interview-starts-at">开始时间（北京时间）</FieldLabel>
                <Input
                  id="interview-starts-at"
                  type="datetime-local"
                  required
                  value={startsAt}
                  onChange={(e) => {
                    changed();
                    setStartsAt(e.target.value);
                  }}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="interview-ends-at">结束时间（北京时间）</FieldLabel>
                <Input
                  id="interview-ends-at"
                  type="datetime-local"
                  required
                  value={endsAt}
                  onChange={(e) => {
                    changed();
                    setEndsAt(e.target.value);
                  }}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="interview-mode">面试方式</FieldLabel>
                <NativeSelect
                  id="interview-mode"
                  value={mode}
                  onChange={(e) => {
                    changed();
                    setMode(e.target.value as typeof mode);
                  }}
                >
                  <NativeSelectOption value="onsite">现场</NativeSelectOption>
                  <NativeSelectOption value="video">视频</NativeSelectOption>
                  <NativeSelectOption value="phone">电话</NativeSelectOption>
                </NativeSelect>
              </Field>
              {mode === 'onsite' && (
                <Field>
                  <FieldLabel htmlFor="interview-location">面试地点</FieldLabel>
                  <Input
                    id="interview-location"
                    required
                    maxLength={1000}
                    value={location}
                    onChange={(e) => {
                      changed();
                      setLocation(e.target.value);
                    }}
                    placeholder="例如：深圳南山区会议室 A"
                  />
                </Field>
              )}
              {mode === 'video' && (
                <Field>
                  <FieldLabel htmlFor="interview-meeting-url">会议链接</FieldLabel>
                  <Input
                    id="interview-meeting-url"
                    type="url"
                    required
                    maxLength={2000}
                    value={meetingUrl}
                    onChange={(e) => {
                      changed();
                      setMeetingUrl(e.target.value);
                    }}
                    placeholder="https://…"
                  />
                </Field>
              )}
              <FieldSet>
                <FieldLegend>面试官（至少一位）</FieldLegend>
                <FieldDescription>仅可选择本部门当前获授权的面试官。</FieldDescription>
                {application.interviewers.map((person) => {
                  const id = `interview-participant-${person.id}`;
                  return (
                    <Field key={person.id} orientation="horizontal">
                      <Checkbox
                        id={id}
                        checked={participants.has(person.id)}
                        onCheckedChange={(checked) => toggle(person, checked)}
                      />
                      <FieldLabel htmlFor={id}>{person.name}</FieldLabel>
                    </Field>
                  );
                })}
              </FieldSet>
            </FieldGroup>
          </FieldSet>
          <Button type="submit" disabled={busy || !participants.size}>
            {busy ? '正在校验并保存…' : '保存排期'}
          </Button>
          {dirty && <small className="text-muted-foreground">尚未保存，离开前会提醒。</small>}
        </form>
      )}
    </section>
  );
}
