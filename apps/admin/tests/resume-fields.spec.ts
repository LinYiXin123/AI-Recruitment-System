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

test('资料分节和联系人信息不能覆盖本人字段，也不从教育和工作年表推断', () => {
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
    education_experience: '2018-2022 虚构大学 本科',
    work_experience: '2022-2026 虚构公司',
    resume_text: text,
  });
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
