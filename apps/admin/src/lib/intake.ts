import type { Person, Requirement } from './api';
export const stages: Record<string, string> = {
  pending_review: '待人工复核',
  needs_information: '待补充',
  ready_to_schedule: '待安排面试',
  closed: '已结束',
};
export const reviewActions: Record<string, string> = {
  advance: '通过复核',
  need_info: '需要补充',
  reject: '不通过',
  supplement: '已补充，交回复核',
  withdraw: '结束应聘（撤回或招聘取消）',
};
export type ResumeParse = {
  id: number;
  version: number;
  status: string;
  text: string;
  error: string;
  parser_version: string;
  actor_name: string;
};
export type ImportItem = {
  id: number;
  name: string;
  document: number;
  application: number | null;
  parse: ResumeParse | null;
};
export type Batch = {
  id: number;
  job: number;
  job_title: string;
  source: string;
  total: number;
  received: number;
  completed: number;
  items: ImportItem[];
  created_at: string;
};
export type Candidate = {
  id: number;
  display_name: string;
  phone: string;
  email: string;
  contact_note: string;
  applications: {
    id: number;
    job_id: number;
    job__title: string;
    attempt_no: number;
    stage: string;
  }[];
};
export type Application = {
  profile: number;
  id: number;
  candidate: number;
  name: string;
  job: number;
  job_title: string;
  attempt_no: number;
  stage: string;
  version: number;
  source: string;
  owner_name: string;
  close_reason: string;
  phone: string;
  email: string;
  contact_note: string;
  job_status: string;
  handlers: Person[];
  requirements: Requirement[];
  resumes: { document: number; name: string; download: boolean; parse: ResumeParse | null }[];
  reviews: {
    id: number;
    action: string;
    reason: string;
    created_at: string;
    reviewer_name: string;
    result_stage: string;
    followup_owner: string | null;
    due_at: string | null;
    input_parses: number[];
  }[];
};
