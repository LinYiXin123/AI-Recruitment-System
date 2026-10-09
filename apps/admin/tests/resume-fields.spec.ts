import { expect, test } from '@playwright/test';
import { resumeFormFields } from '../src/lib/intake';

test('明确简历字段回填同一候选人表单，保留薪资文本和经历原文', () => {
  const text = `姓名：测试甲
手机：13800000000
邮箱：TEST@example.com
性别：女 | 现居城市：泉州
生日：1998年9月28日
意向岗位：前端工程师
最高学历：本科 毕业院校：虚构大学
工作年限：4 年
当前薪资：9K
期望薪资：12-15K · 13薪
[段落 12] 工作经历
2022.06 至今 虚构公司 前端工程师
负责业务页面。
项目经历
测试项目，不应进入工作经历。
教育经历：
2018.09-2022.06 虚构大学 软件工程 本科
专业技能
TypeScript`;
  expect(resumeFormFields(text)).toEqual({
    display_name: '测试甲',
    phone: '13800000000',
    email: 'test@example.com',
    gender: '女',
    current_city: '泉州',
    birthday: '1998-09-28',
    intended_role: '前端工程师',
    education_level: '本科',
    school: '虚构大学',
    work_years: '4 年',
    current_salary: '9K',
    expected_salary: '12-15K · 13薪',
    work_experience: '2022.06 至今 虚构公司 前端工程师\n负责业务页面。',
    education_experience: '2018.09-2022.06 虚构大学 软件工程 本科',
    resume_text: text,
  });
});

test('冲突的身份联系方式和标签不自动选值，身份证和年龄不用于推断', () => {
  const text = `姓名：测试甲
姓名：测试乙
手机：13800000000
手机：13800000001
邮箱：one@example.com
邮箱：two@example.com
现居地：泉州
现居城市：厦门
性别：未说明
最高学历：博士在读
年龄：28
身份证号：110000199809280000`;
  expect(resumeFormFields(text)).toEqual({ resume_text: text });
  expect(resumeFormFields('', '测试甲简历.pdf')).toEqual({});
});

test('资料分节和联系人信息不能覆盖本人字段，也不从工作年表推算年限', () => {
  const text = `测试甲 | 前端开发
手机：13800000000
推荐人：测试乙 现居城市：北京
教育经历
2018-2022 虚构大学 本科
工作经历
2022-2026 虚构公司
紧急联系人
姓名：测试乙
现居城市：北京
期望薪资：20K`;
  expect(resumeFormFields(text)).toEqual({
    display_name: '测试甲',
    phone: '13800000000',
    education_level: '本科',
    school: '虚构大学',
    education_experience: '2018-2022 虚构大学 本科',
    work_experience: '2022-2026 虚构公司',
    resume_text: text,
  });
});

test('应届生简历横排标签与完整分节被识别，籍贯和年月不伪装成城市与生日', () => {
  const text = `测试甲 求职意向：计算机领域
性别：男 民族：汉族 出生年月：2004 年 5 月 毕业院校：虚构学院 学历：本科
年龄：22 籍贯：福建泉州 政治面貌：共青团员 专业：软件工程 电话：13800000000
教育经历
2022.09-2026.06 软件工程 | 本科 虚构学院
实践经历
2025.07-2025.08 测试实践活动
在校经历
2024.09-2025.06 测试社团
项目经历（个人）
测试个人项目
项目经历（企业）
测试企业项目
相关技能
TypeScript
荣誉证书
测试证书
自我评价
测试描述`;
  const fields = resumeFormFields(text);
  expect(fields).toMatchObject({
    display_name: '测试甲',
    phone: '13800000000',
    gender: '男',
    intended_role: '计算机领域',
    school: '虚构学院',
    education_level: '本科',
    education_experience: '2022.09-2026.06 软件工程 | 本科 虚构学院',
  });
  for (const key of [
    'current_city',
    'birthday',
    'work_years',
    'current_salary',
    'expected_salary',
    'source',
  ] as const)
    expect(fields[key]).toBeUndefined();
});

test('教育经历内的学历可识别，不依赖个人信息区再次填写', () => {
  expect(
    resumeFormFields(`姓名：测试甲
工作经历
2023-2026 测试公司
【教育背景】
2019.09-2023.06 虚构大学
软件工程 | 本科
项目经历（个人）
招聘岗位要求硕士学历`),
  ).toMatchObject({
    education_level: '本科',
    school: '虚构大学',
    education_experience: '2019.09-2023.06 虚构大学\n软件工程 | 本科',
  });
  expect(resumeFormFields('教育经历\n2023-至今 虚构大学 硕士在读').education_level).toBeUndefined();
  expect(resumeFormFields('工作经历\n面向本科及以上学生授课').education_level).toBeUndefined();
});

test('常见无冒号基本信息和求职意向字段保留明确值', () => {
  expect(
    resumeFormFields(`基本信息
男 | 28岁 | 本科 | 4年工作经验
现居地 泉州
目前薪酬 9K
求职意向
期望职位 前端工程师 期望月薪 12-15K · 13薪
期望城市 厦门
工作经历
2022-2026 测试公司`),
  ).toMatchObject({
    gender: '男',
    education_level: '本科',
    work_years: '4年',
    current_city: '泉州',
    current_salary: '9K',
    intended_role: '前端工程师',
    expected_salary: '12-15K · 13薪',
  });
  expect(
    resumeFormFields('求职意向\n前端工程师 | 20-30K · 14薪\n工作经历\n测试公司').expected_salary,
  ).toBe('20-30K · 14薪');
});

test('招聘来源只认来源标注或平台简历导出标题，不把任职平台当来源', () => {
  for (const [text, expected] of [
    ['简历来源：BOSS 直聘', 'BOSS直聘'],
    ['来源渠道 猎聘网', '猎聘'],
    ['智联招聘个人简历\n姓名：测试甲', '智联招聘'],
    ['本简历由前程无忧导出', '前程无忧'],
    ['来源：拉勾招聘', '拉勾'],
  ])
    expect(resumeFormFields(text).source).toBe(expected);
  for (const text of [
    '姓名：测试甲\n工作经历\nBOSS直聘\n2022-2026 猎聘 产品经理',
    '姓名：测试甲\n项目经历\n智联招聘招聘系统对接项目',
    '求职意向：加入猎聘，曾经使用 BOSS直聘',
    '简历来源：BOSS直聘\n简历来源：猎聘',
  ])
    expect(resumeFormFields(text).source).toBeUndefined();
});

test('日期只接受真实完整日期或月日，页码全角字符和同行标签可识别', () => {
  for (const [input, expected] of [
    ['２０００／２／２９', '2000-02-29'],
    ['9月28日', '09-28'],
    ['2025-02-29', undefined],
    ['1998年9月', undefined],
  ]) {
    expect(resumeFormFields(`出生日期：${input}`).birthday).toBe(expected);
  }
  expect(resumeFormFields('[第 1 页]\n[段落 1] 性别：女，现居地：泉州；学历：本科')).toMatchObject({
    gender: '女',
    current_city: '泉州',
    education_level: '本科',
  });
  expect(resumeFormFields('工作经验：4年\n期望薪资：12K')).toMatchObject({
    work_years: '4年',
    expected_salary: '12K',
  });
});
