import type { ProfileAnalysis } from '@/pages/application-profile';
import type { Person, Requirement } from './api';

export function identifyResume(text: string, filename = '') {
  // ponytail: 用头部文字及文件名交叉核对姓名；复杂排版仍需人工核对，不凭文件名生成身份。
  const header = text
    .normalize('NFKC')
    .replace(/\[(?:第\s*\d+\s*页|段落\s*\d+)\][ \t]*/g, '')
    .split(
      /^[ \t]*(?:教育(?:经历|背景)|工作(?:经历|经验)|实习经历|项目(?:经历|经验)|专业技能|自我评价|推荐人|证明人|紧急联系人|Education|Work Experience|Projects|References?|Emergency Contacts?)(?:[ \t:：].*)?$/im,
      1,
    )[0]
    .split('\n')
    .filter((line) => !/推荐人|证明人|紧急联系人|招聘(?:联系人|电话|邮箱)|\bHR\b/i.test(line))
    .join('\n');
  const name = [
    ...header.matchAll(
      /(?:姓[ \t]*名|^[ \t]*(?:Full[ \t]+)?Name)[ \t]*:[ \t]*([\p{Script=Han}·](?:[ \t]*[\p{Script=Han}·]){1,19}|[A-Za-z]+(?:[ \t]+[A-Za-z'-]+){0,4})(?=[ \t\r\n|,，;；]|$)/gimu,
    ),
    ...header.matchAll(
      /^[ \t]*([\p{Script=Han}·]{2,20})[ \t]+(?=(?:求职意向|性别|电话|手机|邮箱)[ \t]*:)/gmu,
    ),
  ].map((match) =>
    /^[\p{Script=Han}· \t]+$/u.test(match[1]) ? match[1].replace(/[ \t]/g, '') : match[1].trim(),
  );
  if (!name.length) {
    const lines = header
      .split('\n')
      .map((line) => line.trim())
      .filter(
        (line) => line && !/^(?:个人简历|求职简历|简历|基本信息|个人信息|Resume|CV)$/i.test(line),
      );
    const fileNames = filename
      .normalize('NFKC')
      .replace(/\.(?:pdf|docx)$/i, '')
      .replace(/个人简历|求职简历|简历|\b(?:resume|cv)\b/gi, '|')
      .split(/[|_（）()[\]—–-]+/)
      .map((value) => value.replace(/\s/g, '').toLowerCase());
    for (const [index, line] of lines.slice(0, 3).entries()) {
      const prefix = line.split(/[|丨/／—–]|[ \t]+[-·][ \t]+/, 1)[0].trim();
      const chinesePrefix = prefix.split(
        /[ \t]+(?=[A-Za-z]|\S*(?:工程|经理|开发|设计|运营|销售|助理|专员|主管|总监|顾问|实习))/,
        1,
      )[0];
      const compact = chinesePrefix.replace(/[ \t]/g, '');
      const isChinese = /^[\p{Script=Han}][\p{Script=Han}·]{0,6}[\p{Script=Han}]$/u.test(compact);
      const value = isChinese ? compact : prefix;
      const isEnglish = /^[A-Za-z][A-Za-z'-]*(?:[ \t]+[A-Za-z][A-Za-z'-]*){1,3}$/.test(value);
      if (
        (!isChinese && !isEnglish) ||
        /简历|求职|个人|信息|工程|经理|开发|设计|运营|销售|助理|专员|主管|总监|顾问|实习|应届|本科|硕士|博士|大学|学院|学校|公司|集团|项目|经历|技能|教育|工作|证书|目标|方向|介绍|招聘|resume|engineer|developer|designer|manager|university|college|company|skills|experience|education/i.test(
          value,
        )
      )
        continue;
      const fileAgrees = fileNames.includes(value.replace(/\s/g, '').toLowerCase());
      const separatedTitle = prefix.length < line.length;
      const splitOnSpace = chinesePrefix.length < prefix.length;
      const personalDetails =
        /电话|手机|邮箱|性别|年龄|求职意向|应聘岗位|本科|硕士|博士|毕业|Phone|Email|@|1[3-9]\d{9}/i.test(
          [lines[index - 1] ?? '', ...lines.slice(index + 1, index + 3)].join('\n'),
        );
      if (fileAgrees || (isChinese && !splitOnSpace && (separatedTitle || personalDetails)))
        name.push(value);
    }
  }
  const phone = Array.from(
    header.matchAll(
      /(?<![\dA-Za-z])(?:(?:\+86|0086|86)[ \t-]*)?(1[3-9]\d[ \t-]?\d{4}[ \t-]?\d{4})(?![\dA-Za-z])/g,
    ),
    (match) => match[1].replace(/[ \t-]/g, ''),
  );
  const email = Array.from(
    header.matchAll(
      /(?<![\w.!#$%&'*+/=?^`{|}~-])[a-z0-9]+(?:[._%+-][a-z0-9]+)*@[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?)+(?![\w*-]|\.[\w*])/gi,
    ),
    (match) => match[0].toLowerCase(),
  ).filter((value) => value.length <= 254);
  return { name: [...new Set(name)], phone: [...new Set(phone)], email: [...new Set(email)] };
}

export const stages: Record<string, string> = {
  pending_review: '待筛选',
  needs_information: '待补充',
  ready_to_schedule: '待初试',
  interviewing: '面试中',
  first_interview_passed: '初试通过',
  second_interview: '待复试',
  second_interview_passed: '复试通过',
  offer_sent: '已发offer',
  hired: '已入职',
  closed: '已淘汰',
  talent_pool: '人才库',
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
  profile_analysis?: ProfileAnalysis | null;
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
  interviewers: Person[];
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
