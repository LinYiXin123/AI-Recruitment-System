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

export type ResumeFormFields = Partial<
  Record<
    | 'display_name'
    | 'phone'
    | 'email'
    | 'gender'
    | 'current_city'
    | 'birthday'
    | 'intended_role'
    | 'education_level'
    | 'school'
    | 'work_years'
    | 'current_salary'
    | 'expected_salary'
    | 'source'
    | 'work_experience'
    | 'education_experience'
    | 'resume_text',
    string
  >
>;

export function resumeFormFields(text: string, filename = ''): ResumeFormFields {
  const fields: ResumeFormFields = {};
  if (!text.trim()) return fields;
  fields.resume_text = text.trim();
  const identity = identifyResume(text, filename);
  if (identity.name.length === 1) fields.display_name = identity.name[0];
  if (identity.phone.length === 1) fields.phone = identity.phone[0];
  if (identity.email.length === 1) fields.email = identity.email[0];

  // ponytail: 只识别标签、基本信息短项和明确分节，不从工作起止年份推算年限或猜测缺失信息。
  const normalized = text.normalize('NFKC').replace(/\[(?:第\s*\d+\s*页|段落\s*\d+)\][ \t]*/g, '');
  const sections = Array.from(
    normalized.matchAll(
      /^[ \t#【[]*(教育经历|教育背景|工作经历|工作经验(?![ \t]*:[ \t]*\d)|实习经历|实践经历|在校经历|项目经历(?:\([^\r\n)]*\))?|项目经验|专业技能|相关技能|技能特长|自我评价|个人评价|荣誉奖项|荣誉证书|证书|基本信息|个人信息|求职意向(?=[ \t:】\]]*\r?$)|求职期望|职业意向|推荐人|证明人|紧急联系人|Education|Work Experience|Projects|Skills|References?|Emergency Contacts?)[ \t】\]]*(?::[ \t]*|\r?$)/gim,
    ),
  );
  const header = normalized
    .slice(0, sections[0]?.index ?? normalized.length)
    .split('\n')
    .filter((line) => !/推荐人|证明人|紧急联系人|招聘(?:联系人|电话|邮箱)|\bHR\b/i.test(line))
    .join('\n');
  const labels: Record<string, keyof ResumeFormFields> = {
    性别: 'gender',
    现居城市: 'current_city',
    现居地: 'current_city',
    现居住地: 'current_city',
    现住址: 'current_city',
    居住地: 'current_city',
    居住城市: 'current_city',
    所在地: 'current_city',
    所在城市: 'current_city',
    目前所在地: 'current_city',
    当前城市: 'current_city',
    生日: 'birthday',
    出生日期: 'birthday',
    意向岗位: 'intended_role',
    意向职位: 'intended_role',
    期望职位: 'intended_role',
    期望岗位: 'intended_role',
    求职岗位: 'intended_role',
    求职职位: 'intended_role',
    求职意向: 'intended_role',
    应聘岗位: 'intended_role',
    应聘职位: 'intended_role',
    最高学历: 'education_level',
    学历: 'education_level',
    毕业院校: 'school',
    毕业学校: 'school',
    毕业院校名称: 'school',
    工作年限: 'work_years',
    工作经验: 'work_years',
    工作年数: 'work_years',
    当前薪资: 'current_salary',
    目前薪资: 'current_salary',
    目前薪酬: 'current_salary',
    期望薪资: 'expected_salary',
    期望薪酬: 'expected_salary',
    期望月薪: 'expected_salary',
    期望工资: 'expected_salary',
    薪资要求: 'expected_salary',
    简历来源: 'source',
    来源渠道: 'source',
    招聘渠道: 'source',
    来源: 'source',
  };
  const degrees: Record<string, string> = {
    高中: '高中及以下',
    中专: '高中及以下',
    初中: '高中及以下',
    专科: '大专',
    大学本科: '本科',
    学士: '本科',
    硕士研究生: '硕士',
    博士研究生: '博士',
  };
  const sources: Record<string, string> = {
    boss直聘: 'BOSS直聘',
    智联: '智联招聘',
    智联招聘: '智联招聘',
    猎聘: '猎聘',
    猎聘网: '猎聘',
    前程无忧: '前程无忧',
    '51job': '前程无忧',
    拉勾: '拉勾',
    拉勾网: '拉勾',
    拉勾招聘: '拉勾',
    猎头推荐: '猎头推荐',
    校园招聘: '校园招聘',
    官网投递: '官网投递',
    其他: '其他',
  };
  const values = new Map<keyof ResumeFormFields, Set<string>>();
  function add(key: keyof ResumeFormFields | undefined, raw: string) {
    let value = raw.trim();
    if (!key || !value) return;
    if (key === 'education_level') value = degrees[value] ?? value;
    if (key === 'source') value = sources[value.replace(/\s/g, '').toLowerCase()] ?? value;
    const found = values.get(key) ?? new Set<string>();
    found.add(value);
    values.set(key, found);
  }
  const scopes = [header];
  let education = '';
  let intention = '';
  for (const [index, section] of sections.entries()) {
    if (/推荐人|证明人|紧急联系人|References?|Emergency Contacts?/i.test(section[1])) {
      if (
        normalized
          .slice(section.index + section[0].length)
          .split('\n')[0]
          .trim()
      )
        continue;
      break;
    }
    const value = normalized
      .slice(section.index + section[0].length, sections[index + 1]?.index ?? normalized.length)
      .trim();
    if (/基本信息|个人信息|求职意向|求职期望|职业意向/.test(section[1])) scopes.push(value);
    if (/求职意向|求职期望|职业意向/.test(section[1])) intention += `${value}\n`;
    const key = /^(?:教育|Education)/i.test(section[1])
      ? 'education_experience'
      : /^(?:工作|Work Experience)/i.test(section[1])
        ? 'work_experience'
        : null;
    if (key && value) fields[key] = [fields[key], value].filter(Boolean).join('\n\n');
    if (key === 'education_experience') education += `${value}\n`;
  }
  const labelNames = Object.keys(labels)
    .sort((a, b) => b.length - a.length)
    .join('|');
  const boundaryLabels = `${labelNames}|姓名|年龄|手机|电话|邮箱|户籍|籍贯|期望城市|求职状态|到岗时间`;
  const labelPattern = new RegExp(
    `(?:^|[ \\t|丨,，;；])(${labelNames})[ \\t]*(?::[ \\t]*|[ \\t]+)(.*?)(?=[ \\t|丨,，;；]+(?:(?:${boundaryLabels})[ \\t]*(?::|[ \\t])|[^\\s:|丨,，;；]{2,12}[ \\t]*:)|[|丨;；]|\\r?$)`,
    'gm',
  );
  const personal = scopes.join('\n');
  for (const match of personal.matchAll(labelPattern)) add(labels[match[1]], match[2]);
  const degreePattern =
    /(?:^|[\s|丨·,，;；()])(高中及以下|博士研究生|硕士研究生|大学本科|博士|硕士|本科|学士|大专|专科|高中|中专)(?=$|[\s|丨·,，;；()])/gm;
  for (const token of personal.split(/[\s|丨,，;；]+/)) {
    if (/^[男女]$/.test(token)) add('gender', token);
    if (/^\d+(?:\.\d+)?年(?:工作)?经验$/.test(token))
      add('work_years', token.replace(/(?:工作)?经验$/, ''));
  }
  if (!values.has('education_level')) {
    for (const match of personal.matchAll(degreePattern)) add('education_level', match[1]);
  }
  if (education && !/在读|未毕业|肄业|结业|培训|至今|预计/.test(education)) {
    if (!values.has('education_level')) {
      const levels = ['高中及以下', '大专', '本科', '硕士', '博士'];
      const found = Array.from(
        education.matchAll(degreePattern),
        (match) => degrees[match[1]] ?? match[1],
      );
      const highest = levels.filter((level) => found.includes(level)).at(-1);
      if (highest) add('education_level', highest);
    }
    if (!values.has('school')) {
      for (const match of education.matchAll(/[\p{Script=Han}A-Za-z]{2,60}(?:大学|学院|学校)/gu))
        add('school', match[0].replace(/^(?:毕业于|就读于|毕业院校|学校|院校)/, ''));
    }
  }
  if (!values.has('expected_salary')) {
    for (const match of intention.matchAll(
      /(?:^|[\s|丨])((?:\d+(?:\.\d+)?\s*[-~至]\s*)?\d+(?:\.\d+)?\s*[kK千万元]+(?:\/月)?(?:\s*[·*×]\s*\d+薪)?)(?=$|[\s|丨])/gm,
    ))
      add('expected_salary', match[1]);
  }
  for (const line of normalized.split('\n')) {
    const match = line
      .trim()
      .match(/^(?:本?简历(?:来源|来自|由)|来源平台)[ :]*(.+?)(?:导出|生成|提供)?$/);
    if (match) add('source', match[1]);
  }
  for (const line of header.split('\n')) {
    const match = line.trim().match(/^(.+?)(?:个人简历|人才简历|简历)(?:导出)?$/);
    if (match && sources[match[1].replace(/\s/g, '').toLowerCase()]) add('source', match[1]);
  }
  for (const [key, found] of values) {
    if (found.size === 1) fields[key] = [...found][0];
  }
  if (fields.gender && !['男', '女'].includes(fields.gender)) delete fields.gender;
  if (
    fields.education_level &&
    !['高中及以下', '大专', '本科', '硕士', '博士', '其他'].includes(fields.education_level)
  )
    delete fields.education_level;
  if (fields.source && !Object.values(sources).includes(fields.source)) delete fields.source;
  if (fields.birthday) {
    const birthday = fields.birthday.match(/^(?:(\d{4})[-/.年])?(\d{1,2})[-/.月](\d{1,2})日?$/);
    const year = birthday?.[1] ?? '2000';
    const month = birthday?.[2].padStart(2, '0');
    const day = birthday?.[3].padStart(2, '0');
    const iso = `${year}-${month}-${day}`;
    const date = new Date(`${iso}T00:00:00Z`);
    if (birthday && !Number.isNaN(date.getTime()) && date.toISOString().startsWith(iso))
      fields.birthday = birthday[1] ? iso : `${month}-${day}`;
    else delete fields.birthday;
  }
  return fields;
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
    closed_at: string | null;
  }[];
};
export type Application = {
  profile_analysis?: ProfileAnalysis | null;
  profile: number;
  id: number;
  candidate: number;
  candidate_deleted_at: string | null;
  candidate_updated_at: string;
  can_restore_candidate: boolean;
  name: string;
  job: number;
  job_title: string;
  attempt_no: number;
  stage: string;
  version: number;
  source: string;
  owner_name: string;
  owner_avatar_url: string;
  closed_at: string | null;
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
