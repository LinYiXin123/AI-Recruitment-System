import { expect, test } from '@playwright/test';
import { identifyResume } from '../src/lib/intake';

// 仅验证纯文本识别，不使用浏览器、网络或真实候选人资料。
const cases: {
  title: string;
  texts: string[];
  expected: { name: string[]; phone: string[]; email: string[] };
}[] = [
  {
    title: '空文本不产生建议',
    texts: ['', ' \n\t '],
    expected: { name: [], phone: [], email: [] },
  },
  {
    title: '忽略页码和段落标记后识别明确中文标签',
    texts: [
      '[第 1 页]\n[段落 1] 姓名：测试甲\n[段落 2] 手机：13800000000\n[段落 3] 邮箱：test@example.com',
    ],
    expected: { name: ['测试甲'], phone: ['13800000000'], email: ['test@example.com'] },
  },
  {
    title: '识别明确英文姓名及联系方式标签',
    texts: ['Name: Test Candidate\nPhone: 13800000000\nEmail: TEST@EXAMPLE.COM'],
    expected: { name: ['Test Candidate'], phone: ['13800000000'], email: ['test@example.com'] },
  },
  {
    title: '全角标签数字和邮箱字符统一为半角',
    texts: [
      'Ｎａｍｅ：Ｔｅｓｔ　Ｃａｎｄｉｄａｔｅ\n手机：１３８００００００００\n邮箱：ｔｅｓｔ＠ｅｘａｍｐｌｅ．ｃｏｍ',
    ],
    expected: { name: ['Test Candidate'], phone: ['13800000000'], email: ['test@example.com'] },
  },
  {
    title: '区号和3-4-4格式规范化后去重',
    texts: [
      '姓名：测试甲\n电话：13800000000\n手机：+86 138 0000 0000\n联系电话：0086 138-0000-0000\n备用电话：138-0000-0000\n邮箱：TEST@example.com\n邮箱：test@example.com',
    ],
    expected: { name: ['测试甲'], phone: ['13800000000'], email: ['test@example.com'] },
  },
  {
    title: '多个不同号码和常用域名邮箱保留为多个候选',
    texts: [
      '姓名：测试甲\n手机：13800000000\n备用手机：13800000001\n邮箱：test@example.cn\n备用邮箱：test@example.edu.cn\n电子邮箱：test@example.io',
    ],
    expected: {
      name: ['测试甲'],
      phone: ['13800000000', '13800000001'],
      email: ['test@example.cn', 'test@example.edu.cn', 'test@example.io'],
    },
  },
  {
    title: '身份证和打码联系方式不能拼成有效号码',
    texts: [
      '姓名：测试甲\n身份证号：110000200001010000\n手机：138****0000\n邮箱：t***@example.com',
      '姓名：测试甲\n邮箱：a***b@example.com 或 test@example.c***om',
      '姓名：测试甲\n邮箱：test@example.com.c***om',
    ],
    expected: { name: ['测试甲'], phone: [], email: [] },
  },
  {
    title: '同行的推荐人证明人和紧急联系人均不作为本人建议',
    texts: ['推荐人', '证明人', '紧急联系人'].map(
      (label) => `姓名：测试甲\n${label}：测试乙 电话：13800000001 邮箱：reference@example.com`,
    ),
    expected: { name: ['测试甲'], phone: [], email: [] },
  },
  {
    title: '参考人后续块即使使用姓名电话标签也不作为本人建议',
    texts: ['推荐人', '证明人', '紧急联系人'].map(
      (label) =>
        `姓名：测试甲\n手机：13800000000\n邮箱：test@example.com\n\n${label}\n\n姓名：测试乙\n手机：13800000001\n邮箱：reference@example.com`,
    ),
    expected: { name: ['测试甲'], phone: ['13800000000'], email: ['test@example.com'] },
  },
  {
    title: '首部姓名与求职意向性别或电话标签在同一行相邻时可识别',
    texts: ['求职意向：测试工程师', '性别：未说明', '电话：13800000000'].map(
      (label) => `测试甲 ${label}\n手机：13800000000`,
    ),
    expected: { name: ['测试甲'], phone: ['13800000000'], email: [] },
  },
  {
    title: '普通短标题和文件名不推断为姓名',
    texts: ['个人简历\n产品经理\n测试甲_简历.pdf', '测试工程师\n个人介绍\n测试甲.docx'],
    expected: { name: [], phone: [], email: [] },
  },
  {
    title: '独立一行的职位标题不因下一行有电话而被识别为姓名',
    texts: ['产品经理\n电话：13800000000'],
    expected: { name: [], phone: ['13800000000'], email: [] },
  },
  {
    title: 'Company Name 标签不作为候选人姓名',
    texts: ['Company Name: Fictional Company\nPhone: 13800000000'],
    expected: { name: [], phone: ['13800000000'], email: [] },
  },
  {
    title: '不从包含手机号片段的长数字中截取号码',
    texts: [
      '姓名：测试甲\n编号：991380000000099',
      '姓名：测试甲\n编号：1380000000099',
      `姓名：测试甲\n${'x'.repeat(3981)} 1380000000099`,
    ],
    expected: { name: ['测试甲'], phone: [], email: [] },
  },
  {
    title: '教育工作项目经历区段之后的身份和通讯内容不参与识别',
    texts: ['教育经历', '工作经历', '项目经历'].map(
      (heading) =>
        `姓名：测试甲\n手机：13800000000\n邮箱：test@example.com\n${heading}\n姓名：测试乙\n电话：13800000001\n邮箱：project@example.com`,
    ),
    expected: { name: ['测试甲'], phone: ['13800000000'], email: ['test@example.com'] },
  },
];

test('简历身份建议只提取可核对的头部信息并规范化去重', async () => {
  for (const { title, texts, expected } of cases) {
    await test.step(title, () => {
      for (const text of texts) expect(identifyResume(text)).toEqual(expected);
    });
  }
});
