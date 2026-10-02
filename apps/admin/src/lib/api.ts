export type Requirement = {
  id?: number;
  kind: 'must' | 'preferred' | 'exclusion';
  text: string;
  rationale: string;
  needs_verification: boolean;
  source_kind?: string;
  source_quote?: string;
  source_reference?: string;
  source_edited?: boolean;
  generation_index?: number | null;
};
export type Profile = {
  id: number;
  number: number;
  jd_snapshot: string;
  source: string;
  business_goal?: string;
  status: string;
  requirements: Requirement[];
  created_at: string;
  created_by_name: string;
  confirmed_by_name: string | null;
  confirmed_at: string | null;
  review_note: string;
};
export type Job = {
  active_profile: number | null;
  active_profile_number: number | null;
  id: number;
  title: string;
  department: number;
  department_name: string;
  company_name: string;
  enterprise_id?: number | null;
  enterprise_name?: string;
  enterprise_enabled?: boolean | null;
  enterprise_deleted?: boolean;
  job_level: string;
  salary_range: string;
  base_salary: string;
  performance_salary: string;
  commission_salary: string;
  total_monthly_salary: string;
  planned_publish_date: string | null;
  location: string;
  headcount: number;
  owner_name: string;
  approver_name: string;
  status: string;
  jd: string;
  version: number;
  updated_at: string;
  latest_profile: Profile | null;
  permissions: { edit: boolean; confirm: boolean };
};
export type Task = {
  kind: string;
  kind_label: string;
  id: number;
  job_id: number;
  job_title: string;
  profile_number: number | null;
  application: number | null;
  candidate_name: string | null;
  due_at: string | null;
  assignee_name: string;
  created_at: string;
  status: string;
};
export type Clarification = {
  id: number;
  profile: number;
  profile_number: number;
  requirement: number;
  requirement_text: string;
  question: string;
  status: 'pending' | 'answered' | 'withdrawn';
  answer: string;
  answered_at: string | null;
  created_at: string;
  assignee_name: string;
  requester_name: string;
  can_answer: boolean;
};
export type Person = { id: number; name: string };
export type Me = {
  name: string;
  avatar_url: string;
  auth_source: 'feishu' | 'local';
  organization: string;
  roles: string[];
  departments: { id: number; name: string; approvers: Person[]; collaborators: Person[] }[];
};
export type DashboardData = {
  period: { week_start: string; week_end: string; today: string };
  metrics: {
    talent_pool_total: number;
    resumes_today: number;
    interviews_today: number;
    offers_this_week: number | null;
    pending_onboarding: number | null;
    hired_total: number | null;
  };
  capabilities: { offer: boolean; onboarding: boolean };
  daily_resumes: { date: string; count: number }[];
  candidate_stages: { stage: string; label: string; count: number }[];
  today_interviews: {
    id: number;
    candidate_name: string;
    job_title: string;
    starts_at: string;
    mode: string;
    status: string;
  }[];
  other_totals: {
    open_jobs: number;
    jobs: number;
    interviews: number;
    question_bank: number;
  };
};
export type Page<T> = { count: number; next: string | null; previous: string | null; results: T[] };
export type Audit = {
  id: number;
  action: string;
  actor_name: string;
  job_version: number;
  note: string;
  created_at: string;
};
let csrfToken = '';
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
function errorText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(errorText).join('；');
  if (value && typeof value === 'object') return Object.values(value).map(errorText).join('；');
  return '请求失败，请稍后重试。';
}
export async function api<T>(
  path: string,
  data?: unknown,
  signal?: AbortSignal,
  method?: 'POST' | 'PATCH' | 'DELETE',
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/${path}`, {
      method: method ?? (data === undefined ? 'GET' : 'POST'),
      credentials: 'same-origin',
      signal,
      headers:
        data === undefined
          ? {}
          : data instanceof FormData
            ? { 'X-CSRFToken': csrfToken }
            : { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken },
      body: data === undefined ? undefined : data instanceof FormData ? data : JSON.stringify(data),
    });
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw e;
    throw new ApiError(0, '暂时连接不上服务，请检查网络后重试。已填写的内容会保留。');
  }
  const body = await response.json().catch((e: unknown) => {
    if (e instanceof Error && e.name === 'AbortError') throw e;
    if (response.ok && response.status !== 204)
      throw new ApiError(response.status, '服务返回内容无法读取，请重试。已填写的内容会保留。');
    return {};
  });
  if (!response.ok)
    throw new ApiError(response.status, errorText(body.errors || '服务暂时不可用，请重试。'));
  if (body.csrfToken) csrfToken = body.csrfToken;
  return body as T;
}

export async function downloadApi(path: string, filename: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/${path}`, { credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, '暂时连接不上服务，请检查网络后重新导出。');
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(response.status, errorText(body.errors || '导出失败，请重试。'));
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const jobStatus: Record<string, string> = {
  draft: '草稿',
  open: '招聘中',
  paused: '暂停',
  closed: '关闭',
};
export const profileStatus: Record<string, string> = {
  draft: '草稿',
  pending: '待确认',
  confirmed: '已确认',
  changes_requested: '需补充',
  withdrawn: '已被新版替代',
};
export const kindLabel: Record<string, string> = {
  must: '必须满足',
  preferred: '优先考虑',
  exclusion: '排除信号',
};
export const dateTime = (value: string) =>
  new Date(value).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
